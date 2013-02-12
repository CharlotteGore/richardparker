'use strict';

exports = module.exports = render;
exports.compile = compile;

/**
 * Render template a string with data
 *
 * @param {String} str
 * @param {Object} data
 * @param {Object} macros
 * @return {String}
 */
function render (str, data, macros) {
    return compile(str, macros)(data);
}

/**
 * Compile a template to a Javascript
 *
 * @param {String} input
 * @param macros
 * @return {*}
 */
function compile (input, macros) {
    macros = macros || {};

    var tree = parse('out ' + input);

    function transform (tree) {

        var macroName = helper.parseArg(tree),
            macro = macros[macroName] || nativeMacros[macroName];

        if (macro) {
            return macro(tree, transform);
        }

        throw new Error('Not a macro:' + macroName);
    }

    return helper.wrapTemplate(transform(tree));
}

/**
 * Parse str in a tree structure
 * '{example {foo {bar}} {bla}}'
 * ->
 *    [
 *      'example ',
 *      ['foo ', ['bar']],
 *      ' ',
 *      ['bla']
 *    ]
 *
 * @param str
 * @return {Array}
 */
function parse (str) {
    var results = [''],
        current = results,
        stack = [],
        parent;

    for (var i = 0; i < str.length; i++) {
        switch (str[i]) {
            case '{':
                stack.push(current);
                current = [''];
                break;
            case '}':
                parent = stack.pop();
                parent.push(current);
                current = parent;
                current.push('');
                break;
            default:
                current[current.length - 1] += str[i];
        }
    }
    if (stack.length !== 0) {
        throw new Error('Unmatched brace');
    }
    return results;
}


/**
 * Some bundled macros
 */
var nativeMacros = {

    /**
     * Resolves a value
     * for example:
     * {.pages[3].title} or also just {.}
     *
     * @param tree
     * @return {String}
     */
    '.': function (tree) {
        var path = helper.parsePath(tree);
        return '__out.push(resolve(addToPath(path, "' + path + '")));';
    },

    /**
     * Moves down in path
     * {-> person.name {path}} -> person.name
     * @param tree
     * @param transform
     * @return {String}
     */
    '->': function (tree, transform) {
        var path = helper.parsePath(tree);
        return helper.keepPath(
            'path = addToPath(path, "' + path + '");\n' +
            helper.transformTree(tree, transform) + '\n'
        );
    },

    /**
     * Checks if a path exists
     * for example:
     * {has title <h1>{. title}</h1>}
     *
     * @param tree
     * @param transform
     * @return {String}
     */
    has: function (tree, transform) {
        var path = helper.parsePath(tree);
        return  'if (typeof resolve(addToPath(path, "' + path + '")) !== "undefined") {\n' +
            helper.transformTree(tree, transform) + '\n' +
            '}';
    },

    /**
     * Iterates over an array or object
     * for example:
     * <ul>
     *  {each pages
     *    <li>{. title}</li>
     *  }
     * </ul>
     *
     * @param tree
     * @param transform
     * @return {String}
     */
    each: function (tree, transform) {
        var path = helper.parsePath(tree);
        return helper.keepPath(
            'path = addToPath(path, "' + path + '");\n' +
            'each(resolve(path), function (__itemPath) {' +
                helper.keepPath('path = addToPath(path, __itemPath);' + helper.transformTree(tree, transform)) + '\n' +
            '});'
        );
    },

    /**
     * Outputs the current path
     * for example:
     * {each foo {path bar} } -> foo.0.bar foo.1.bar
     * @param tree
     * @return {String}
     */
    path: function (tree) {
        var path = helper.parsePath(tree);
        return '__out.push(addToPath(path, "' + path + '"));';
    },

    /**
     * Output ast, for internal use
     */
    out: function (tree, transform) {
        return helper.transformTree(tree, transform);
    }
};

/**
 * Some helper functions for generating javascript in macros
 *
 * @type {Object}
 */
var helper = {

    /**
     * Read until the first white space in the first string of the AST
     *
     * @param [tree]
     * @return {String}
     */
    parseArg: function (tree) {
        var arg = String(/^\S+/.exec(String(tree[0])) || '');
        tree[0] = tree[0].substr(arg.length).replace(/^\s+/, '');
        return arg;
    },

    parsePath: function (tree) {
        return helper.parseArg(tree) || '';
    },

    /**
     * Escape a string not to interfere with javascript syntax
     *
     * @param {String} str
     * @return {String}
     */
    escapeJS: function (str) {
        return String(str)
            .replace(/"/g, '\\"')
            .replace(/'/g, "\\'")
            .replace(/\n/g, '\\n');
    },

    /**
     * Output a string
     *
     * @param {String} str
     * @return {String}
     */
    output: function (str) {
        if (str === '') { return ''; }
        return '__out.push("' + helper.escapeJS(str) +'");';
    },

    /**
     * Transform a part of the AST
     *
     * @param tree
     * @param transform
     * @return {String}
     */
    transformTree: function (tree, transform) {
        var out = '';
        each(tree, function (i, item) {
            if (typeof item === 'string') {
                out += helper.output(item);
            } else {
                out += transform(item, transform);
            }
        });
        return out;
    },

    /**
     * Creates a closure for the path.
     *  ->  Useful when modifying the current path in a macro
     *      so it not required to be restored after.
     *
     * @param {String} code
     * @return {String}
     */
    keepPath: function (code) {
        return '(function (path) {\n' + code + '\n}(path));';
    },

    /**
     * Wrap code into the template function
     *
     * @param code
     * @return {String}
     */
    wrapTemplate: function (code) {
        return new Function('data',
            'var path = "", __out = [];\n data = data || {};\n' +
                addToPath.toString() + '\n' +
                resolve.toString() + '\n' +
                each.toString() + '\n' +
                code + '\n' +
                'return __out.join("");'
        );
    }
};

compile.helper = helper;

/**
 * Runtime method: resolving a path in the data
 *
 * @param {String} path
 * @return {*}
 */
function resolve (path) {
    var obj = data,
        parts = path.split(/\./);

    if (path === '' || path === '.') {
        return obj;
    }

    while (parts.length > 0 && obj[parts[0]]) {
        obj = obj[parts[0]];
        parts.shift();
    }
    if (parts.length > 0) {
        return;
    }
    return obj;
}

/**
 * Iterate over an object or array
 * - included in runtime
 *
 * @param obj
 * @param iterator
 */
function each (obj, iterator) {
    if (!obj) return;
    if (obj instanceof Array) {
        for (var i = 0; i < obj.length; i++) {
            iterator(i, obj[i]);
        }
    } else {
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
                iterator(key, obj[key]);
            }
        }
    }
}

function addToPath (path, part) {
    path = String(path);
    part = String(part);
    if (path === '' && part === '') {
        return '.';
    }
    if (part === '.' || part === '') {
        return path;
    }
    return path ? path + '.' + part : part;
}
