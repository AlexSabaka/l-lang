/**
 * Custom highlight.js language definition for l-lang
 * Provides syntax highlighting for the l-lang Lisp dialect
 */

import type { Language, Mode } from "highlight.js";

export default function llangHighlighter(hljs: any): Language {
  // Keywords that should be highlighted
  const KEYWORDS = {
    keyword: [
      'defclass', 'definterface', 'deftype', 'defenum', 'defstruct',
      'fn', 'let', 'mut', 'const',
      'if', 'when', 'cond', 'match', 'case',
      'for', 'while', 'do', 'loop',
      'try', 'catch', 'finally', 'throw',
      'return', 'break', 'continue',
      'import', 'export', 'from', 'as',
      'namespace', 'module',
      'async', 'await',
      'new', 'this', 'super',
      'public', 'private', 'protected', 'internal',
      'static', 'readonly', 'extern', 'ctor'
    ].join(' '),
    literal: [
      'nil', 'null', 'undefined', 'none', 'void',
      '#t', '#f', 'true', 'false'
    ].join(' '),
    built_in: [
      'console', 'Math', 'Array', 'Object', 'String', 'Number',
      'head', 'tail', 'get', 'set!', 'list', 'cons',
      'map', 'filter', 'reduce', 'fold',
      'type', 'typeof', 'instanceof'
    ].join(' ')
  };

  // Modifiers and special keywords
  const MODIFIERS = [
    ':implements', ':extends', ':where',
    ':cond', ':then', ':else',
    ':init', ':step', ':each', ':from',
    ':public', ':private', ':protected', ':internal',
    ':static', ':readonly', ':extern', ':ctor'
  ];

  const COMMENT: Mode = {
    scope: 'comment',
    begin: ';',
    end: '$',
    contains: []
  };

  const STRING: Mode = {
    scope: 'string',
    variants: [
      {
        begin: '"',
        end: '"',
        contains: [
          hljs.BACKSLASH_ESCAPE,
          {
            scope: 'subst',
            begin: /\{/,
            end: /\}/,
            contains: []
          }
        ]
      },
      {
        begin: "'",
        end: "'",
        contains: [
          hljs.BACKSLASH_ESCAPE,
          {
            scope: 'subst',
            begin: /\{/,
            end: /\}/,
            contains: []
          }
        ]
      }
    ]
  };

  const NUMBER: Mode = {
    scope: 'number',
    variants: [
      { begin: /\b0x[0-9a-fA-F]+/ },           // Hexadecimal
      { begin: /\b0b[01]+/ },                   // Binary
      { begin: /\b\d+\/\d+/ },                  // Fraction
      { begin: /\b\d+\.\d+([eE][+-]?\d+)?/ },  // Float
      { begin: /\b\d+/ }                        // Integer
    ]
  };

  const MODIFIER: Mode = {
    scope: 'attr',
    begin: new RegExp('(' + MODIFIERS.join('|') + ')\\b', 'i')
  };

  const OPERATOR: Mode = {
    scope: 'operator',
    begin: /(:=|\|>|<\||<-|->|=>|\+=|-=|\*=|\/=|%=|\+\+|--|==|!=|<=|>=|&&|\|\||[+\-*\/%^<>=!&|])/
  };

  const TYPE_ANNOTATION: Mode = {
    scope: 'type',
    begin: /<-/,
    end: /(?=\)|\s|$)/,
    contains: [
      {
        scope: 'type',
        begin: /[A-Z][a-zA-Z0-9]*/
      }
    ]
  };

  const SYMBOL: Mode = {
    scope: 'symbol',
    begin: /:[a-zA-Z][a-zA-Z0-9-]*/
  };

  const FUNCTION_CALL: Mode = {
    scope: 'title.function',
    begin: /\(/,
    end: /(?=\s|\))/,
    excludeBegin: true,
    excludeEnd: true,
    keywords: KEYWORDS,
    contains: []
  };

  const CLASS_REFERENCE: Mode = {
    scope: 'title.class',
    begin: /\b[A-Z][a-zA-Z0-9]*/
  };

  const VARIABLE: Mode = {
    scope: 'variable',
    begin: /\b[a-z][a-zA-Z0-9-]*\b/
  };

  return {
    name: 'l-lang',
    case_insensitive: true,
    keywords: KEYWORDS,
    contains: [
      COMMENT,
      STRING,
      NUMBER,
      MODIFIER,
      OPERATOR,
      TYPE_ANNOTATION,
      SYMBOL,
      FUNCTION_CALL,
      CLASS_REFERENCE,
      VARIABLE,
      {
        scope: 'punctuation',
        begin: /[()[\]{}]/
      }
    ]
  };
}
