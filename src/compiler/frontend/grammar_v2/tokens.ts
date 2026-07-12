/**
 * l-lang Lexer Tokens
 *
 * This lexer uses multi-mode lexing to handle formatted strings properly.
 * The key insight is that formatted strings need to balance {} braces for expressions.
 */
import { createToken, Lexer, TokenType } from "chevrotain";

// ============================================================================
// WHITESPACE & COMMENTS
// ============================================================================
export const WhiteSpace = createToken({
  name: "WhiteSpace",
  pattern: /[ \t\n\r]+/,
  group: Lexer.SKIPPED,
});

export const Comment = createToken({
  name: "Comment",
  pattern: /;[^\n\r]*/,
});

// ============================================================================
// IDENTIFIER - declared here (ahead of its "MUST be last" position in the
// token arrays below) so the keyword tokens can reference it via
// `longer_alt`. Array order below still governs lexer priority, not
// declaration order -- Identifier/OperatorIdent still go last in every mode's
// token list, exactly as the original.
// ============================================================================
export const Identifier = createToken({
  name: "Identifier",
  pattern: /[a-zA-Z_][a-zA-Z0-9_\-]*/,
});

// ============================================================================
// KEYWORDS
// Order: longer patterns first, then alphabetically
//
// D14 fix: every plain keyword below sets `longer_alt: Identifier` and drops
// the `/i` case-insensitive flag -- both were the single largest bug class in
// the l-lang stabilization audit. Without `longer_alt`, `(let nullable 1)`
// misparsed as LetKw + NilKw("null") + Identifier("able") because nothing
// told the lexer to prefer a longer Identifier match over a keyword prefix.
// See docs/spec/DECISIONS.md#d14.
// ============================================================================
// Declaration Keywords
export const DefInterfaceKw = createToken({ name: "DefInterfaceKw", pattern: /definterface/, longer_alt: Identifier });
export const DefModifierKw = createToken({ name: "DefModifierKw", pattern: /defmodifier/, longer_alt: Identifier });
export const DefStructKw = createToken({ name: "DefStructKw", pattern: /defstruct/, longer_alt: Identifier });
export const DefClassKw = createToken({ name: "DefClassKw", pattern: /defclass/, longer_alt: Identifier });
export const DefMacroKw = createToken({ name: "DefMacroKw", pattern: /defmacro/, longer_alt: Identifier });
export const DefEnumKw = createToken({ name: "DefEnumKw", pattern: /defenum/, longer_alt: Identifier });
export const DefTypeKw = createToken({ name: "DefTypeKw", pattern: /deftype/, longer_alt: Identifier });
// Control Flow Keywords
export const FinallyKw = createToken({ name: "FinallyKw", pattern: /finally/, longer_alt: Identifier });
export const MatchKw = createToken({ name: "MatchKw", pattern: /match/, longer_alt: Identifier });
export const WhileKw = createToken({ name: "WhileKw", pattern: /while/, longer_alt: Identifier });
export const CatchKw = createToken({ name: "CatchKw", pattern: /catch/, longer_alt: Identifier });
export const AwaitKw = createToken({ name: "AwaitKw", pattern: /await/, longer_alt: Identifier });
export const AsyncKw = createToken({ name: "AsyncKw", pattern: /async/, longer_alt: Identifier });
export const CondKw = createToken({ name: "CondKw", pattern: /cond/, longer_alt: Identifier });
export const WhenKw = createToken({ name: "WhenKw", pattern: /when/, longer_alt: Identifier });
export const TryKw = createToken({ name: "TryKw", pattern: /try/, longer_alt: Identifier });
export const ForKw = createToken({ name: "ForKw", pattern: /for/, longer_alt: Identifier });
export const IfKw = createToken({ name: "IfKw", pattern: /if/, longer_alt: Identifier });
// Module Keywords
export const ExportKw = createToken({ name: "ExportKw", pattern: /export/, longer_alt: Identifier });
export const ImportKw = createToken({ name: "ImportKw", pattern: /import/, longer_alt: Identifier });
export const FromKw = createToken({ name: "FromKw", pattern: /from/, longer_alt: Identifier });
// Other Keywords
export const KeyOfKw = createToken({ name: "KeyOfKw", pattern: /keyof/, longer_alt: Identifier });
export const MutKw = createToken({ name: "MutKw", pattern: /mut/, longer_alt: Identifier });
export const LetKw = createToken({ name: "LetKw", pattern: /let/, longer_alt: Identifier });
export const FnKw = createToken({ name: "FnKw", pattern: /fn/, longer_alt: Identifier });
// Boolean Literals (before Identifier)
export const TrueKw = createToken({ name: "TrueKw", pattern: /true|#t/, longer_alt: Identifier });
export const FalseKw = createToken({ name: "FalseKw", pattern: /false|#f/, longer_alt: Identifier });
// Nil Keywords
export const NilKw = createToken({
  name: "NilKw",
  pattern: /nil|null|none|void|undefined/,
  longer_alt: Identifier,
});

// ============================================================================
// MODIFIER KEYWORDS (start with colon)
// No longer_alt: these can never collide with Identifier (which never starts
// with `:`), so there's no keyword/identifier ambiguity to resolve here.
// ============================================================================
export const ImplementsModKw = createToken({ name: "ImplementsModKw", pattern: /:implements/i });
export const ExtendsModKw = createToken({ name: "ExtendsModKw", pattern: /:extends/i });
export const WhereModKw = createToken({ name: "WhereModKw", pattern: /:where/i });
export const CondModKw = createToken({ name: "CondModKw", pattern: /:cond/i });
export const ThenModKw = createToken({ name: "ThenModKw", pattern: /:then/i });
export const ElseModKw = createToken({ name: "ElseModKw", pattern: /:else/i });
export const InitModKw = createToken({ name: "InitModKw", pattern: /:init/i });
export const StepModKw = createToken({ name: "StepModKw", pattern: /:step/i });
export const EachModKw = createToken({ name: "EachModKw", pattern: /:each/i });
export const FromModKw = createToken({ name: "FromModKw", pattern: /:from/i });
export const AsModKw = createToken({ name: "AsModKw", pattern: /:as/i });
export const OfModKw = createToken({ name: "OfModKw", pattern: /:of/i });
export const IsModKw = createToken({ name: "IsModKw", pattern: /:is/i });

// ============================================================================
// OPERATORS (Multi-char before single-char!)
// ============================================================================
export const RightDoubleArrow = createToken({ name: "RightDoubleArrow", pattern: /=>/ });
export const LeftArrow = createToken({ name: "LeftArrow", pattern: /<-/ });
export const RightArrow = createToken({ name: "RightArrow", pattern: /->/ });
// Compound Assignments
export const PlusEq = createToken({ name: "PlusEq", pattern: /\+=/ });
export const MinusEq = createToken({ name: "MinusEq", pattern: /-=/ });
export const StarEq = createToken({ name: "StarEq", pattern: /\*=/ });
export const SlashEq = createToken({ name: "SlashEq", pattern: /\/=/ });
export const PercentEq = createToken({ name: "PercentEq", pattern: /%=/ });
export const AmpersandEq = createToken({ name: "AmpersandEq", pattern: /&=/ });
export const PipeEq = createToken({ name: "PipeEq", pattern: /\|=/ });
export const CaretEq = createToken({ name: "CaretEq", pattern: /\^=/ });
export const TildeEq = createToken({ name: "TildeEq", pattern: /~=/ });
export const ExclamationEq = createToken({ name: "ExclamationEq", pattern: /!=/ });
export const EqualEq = createToken({ name: "EqualEq", pattern: /==/ });
export const ColonEq = createToken({ name: "ColonEq", pattern: /:=/ });
// Other multi-char operators
export const Spread = createToken({ name: "Spread", pattern: /\.\.\./ });
// Single-char operators with negative lookahead to prevent consuming multi-char
export const Dot = createToken({ name: "Dot", pattern: /\.(?!\.)/ });
export const Pipe = createToken({ name: "Pipe", pattern: /\|(?![=|>])/ });
export const Ampersand = createToken({ name: "Ampersand", pattern: /&(?![=&])/ });
export const Equal = createToken({ name: "Equal", pattern: /=(?![=>])/ });
export const Plus = createToken({ name: "Plus", pattern: /\+(?!=)/ });
export const Minus = createToken({ name: "Minus", pattern: /-(?![=>])/ });
export const Star = createToken({ name: "Star", pattern: /\*(?!=)/ });
export const Slash = createToken({ name: "Slash", pattern: /\/(?!=)/ });
export const Percent = createToken({ name: "Percent", pattern: /%(?!=)/ });
export const Caret = createToken({ name: "Caret", pattern: /\^(?!=)/ });
export const Question = createToken({ name: "Question", pattern: /\?/ });
export const Exclamation = createToken({ name: "Exclamation", pattern: /!(?!=)/ });
export const Tilde = createToken({ name: "Tilde", pattern: /~(?!=)/ });
export const Comma = createToken({ name: "Comma", pattern: /,/ });
export const Underscore = createToken({ name: "Underscore", pattern: /_(?![a-zA-Z0-9])/ }); // Standalone underscore

// ============================================================================
// BRACKETS & DELIMITERS
// ============================================================================
export const LParen = createToken({ name: "LParen", pattern: /\(/ });
export const RParen = createToken({ name: "RParen", pattern: /\)/ });
export const LBracket = createToken({ name: "LBracket", pattern: /\[/ });
export const RBracket = createToken({ name: "RBracket", pattern: /\]/ });
export const LBrace = createToken({ name: "LBrace", pattern: /\{/ });
export const RBrace = createToken({ name: "RBrace", pattern: /\}/ });
export const LAngle = createToken({ name: "LAngle", pattern: /<(?![-=])/ }); // Not followed by - or =
export const RAngle = createToken({ name: "RAngle", pattern: />(?!=)/ }); // Not followed by =
export const Colon = createToken({ name: "Colon", pattern: /:(?![a-zA-Z=])/ }); // Not followed by letter or =

// ============================================================================
// LITERALS
// ============================================================================
// Numbers (Most specific first!)
export const ComplexNumber = createToken({
  name: "ComplexNumber",
  pattern: /[+-]?[0-9]+\.?[0-9]*[+-][0-9]+\.?[0-9]*[ij]/i,
});
export const FractionNumber = createToken({
  name: "FractionNumber",
  pattern: /[+-]?[0-9]+\/[0-9]+/,
});
export const HexNumber = createToken({
  name: "HexNumber",
  pattern: /0x[0-9a-fA-F]+/,
});
export const BinaryNumber = createToken({
  name: "BinaryNumber",
  pattern: /0b[01]+/,
});
export const OctalNumber = createToken({
  name: "OctalNumber",
  pattern: /0[0-7]+/,
});
export const FloatNumber = createToken({
  name: "FloatNumber",
  pattern: /[+-]?[0-9]+\.[0-9]*([eE][+-]?[0-9]+)?|[+-]?[0-9]+[eE][+-]?[0-9]+/,
});
export const IntegerNumber = createToken({
  name: "IntegerNumber",
  pattern: /[+-]?[0-9]+/,
});
// Formatted String Tokens (lexer mode switching)
export const FormattedStringStart = createToken({
  name: "FormattedStringStart",
  pattern: /'"/,
  push_mode: "formatted_string_mode",
});
export const FormattedStringEnd = createToken({
  name: "FormattedStringEnd",
  pattern: /"/,
  pop_mode: true,
});
export const FormatExprStart = createToken({
  name: "FormatExprStart",
  pattern: /\{/,
  push_mode: "format_expr_mode",
});
export const FormatExprEnd = createToken({
  name: "FormatExprEnd",
  pattern: /\}/,
  pop_mode: true,
});
export const StringContent = createToken({
  name: "StringContent",
  pattern: /(?:[^"\\{]|\\["\\/bfnrtu{]|\\u[0-9a-fA-F]{4})+/,
  line_breaks: true,
});
export const Quote = createToken({ name: "Quote", pattern: /'(?!")/ }); // Not followed by "
export const StringLiteral = createToken({
  name: "StringLiteral",
  pattern: /"(?:[^"\\]|\\.)*"/,
});

// ============================================================================
// OPERATOR IDENTIFIER (catch-all, must be last alongside Identifier)
// ============================================================================
// Operator identifier (for operator overloading like `fn :operator + [...]`)
// This catches operators when used as function names
export const OperatorIdent = createToken({
  name: "OperatorIdent",
  pattern: /[*+\-\\/^&%$#@!~=|<>?]+/,
});

// ============================================================================
// TOKEN GROUPS FOR LEXER MODES
// ============================================================================
export const defaultModeTokens: TokenType[] = [
  WhiteSpace,
  Comment,
  // Keywords (most specific first)
  DefInterfaceKw, DefModifierKw, DefStructKw, DefClassKw, DefMacroKw, DefEnumKw, DefTypeKw,
  FinallyKw, MatchKw, WhileKw, CatchKw, AwaitKw, AsyncKw,
  CondKw, WhenKw, TryKw, ForKw, IfKw,
  ExportKw, ImportKw, FromKw,
  KeyOfKw, MutKw, LetKw, FnKw,
  TrueKw, FalseKw, NilKw,
  // Modifier Keywords (start with :)
  ImplementsModKw, ExtendsModKw, WhereModKw,
  CondModKw, ThenModKw, ElseModKw,
  InitModKw, StepModKw, EachModKw, FromModKw,
  AsModKw, OfModKw, IsModKw,
  // Multi-char operators first!
  RightDoubleArrow, LeftArrow, RightArrow,
  PlusEq, MinusEq, StarEq, SlashEq, PercentEq,
  AmpersandEq, PipeEq, CaretEq, TildeEq,
  ExclamationEq, EqualEq, ColonEq,
  Spread,
  // Brackets
  LParen, RParen, LBracket, RBracket, LBrace, RBrace,
  LAngle, RAngle,
  // Literals (most specific first!) before single-char operators
  ComplexNumber, FractionNumber,
  HexNumber, BinaryNumber, OctalNumber,
  FloatNumber, IntegerNumber,
  FormattedStringStart, Quote, StringLiteral,
  // Single-char operators after numbers (so +/- in numbers match first)
  Dot, Pipe, Ampersand, Equal, Plus, Minus, Star, Slash,
  Percent, Caret, Question, Exclamation, Tilde, Comma, Colon, Underscore,
  // Identifiers (MUST be last!)
  Identifier,
  OperatorIdent,
];

export const formattedStringModeTokens: TokenType[] = [
  StringContent,
  FormatExprStart,
  FormattedStringEnd,
];

// Format expression mode - supports nested expressions including nested {}
export const formatExprModeTokens: TokenType[] = [
  WhiteSpace,
  Comment,
  // Keywords
  DefInterfaceKw, DefModifierKw, DefStructKw, DefClassKw, DefMacroKw, DefEnumKw, DefTypeKw,
  FinallyKw, MatchKw, WhileKw, CatchKw, AwaitKw, AsyncKw,
  CondKw, WhenKw, TryKw, ForKw, IfKw,
  ExportKw, ImportKw, FromKw,
  KeyOfKw, MutKw, LetKw, FnKw,
  TrueKw, FalseKw, NilKw,
  // Modifier Keywords
  ImplementsModKw, ExtendsModKw, WhereModKw,
  CondModKw, ThenModKw, ElseModKw,
  InitModKw, StepModKw, EachModKw, FromModKw,
  AsModKw, OfModKw, IsModKw,
  // Operators
  RightDoubleArrow, LeftArrow, RightArrow,
  PlusEq, MinusEq, StarEq, SlashEq, PercentEq,
  AmpersandEq, PipeEq, CaretEq, TildeEq,
  ExclamationEq, EqualEq, ColonEq,
  Spread,
  // Brackets - FormatExprStart pushes another format_expr_mode for nesting
  LParen, RParen, LBracket, RBracket,
  FormatExprStart, FormatExprEnd, // {} with mode push/pop for nesting
  LAngle, RAngle,
  // Literals
  ComplexNumber, FractionNumber,
  HexNumber, BinaryNumber, OctalNumber,
  FloatNumber, IntegerNumber,
  Quote, StringLiteral,
  // Operators
  Dot, Pipe, Ampersand, Equal, Plus, Minus, Star, Slash,
  Percent, Caret, Question, Exclamation, Tilde, Comma, Colon, Underscore,
  // Identifiers
  Identifier,
  OperatorIdent,
];

// ============================================================================
// LEXER DEFINITION
// ============================================================================
export const LLangLexer = new Lexer(
  {
    modes: {
      default_mode: defaultModeTokens,
      formatted_string_mode: formattedStringModeTokens,
      format_expr_mode: formatExprModeTokens,
    },
    defaultMode: "default_mode",
  },
  {
    ensureOptimizations: false,
    positionTracking: "full",
  }
);

// Export all tokens as an array for the parser
export const allTokens: TokenType[] = [
  ...defaultModeTokens,
  ...formattedStringModeTokens.filter((t) => !defaultModeTokens.includes(t)),
  ...formatExprModeTokens.filter(
    (t) => !defaultModeTokens.includes(t) && !formattedStringModeTokens.includes(t)
  ),
];
