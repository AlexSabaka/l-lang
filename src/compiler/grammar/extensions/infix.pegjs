{

}

Expression
  = Additive

Additive
  = _ r:Multiplicative _ op:[+-] _ l:Multiplicative _ {
    return {
      _type: "list",
      nodes: [
        {
          _type: "simple-identifier",
          id: op,
        },
        r,
        l,
      ],
    };
  }
  / _ @Multiplicative _

Multiplicative
  = _ r:Term _ op:[*/] _ l:Term _ {
    return {
      _type: "list",
      nodes: [
        {
          _type: "simple-identifier",
          id: op,
        },
        r,
        l,
      ],
    };
  }
  / _ @Term _

FuncCall
  = _ id:Identifier _ "(" _ args:FuncAgrs _ ")" _ {
    return {
      _type: "list",
      nodes: [
        id,
        ...args,
      ],
    };
  }

FuncAgrs
  = h:Expression t:("," @Expression)+ { return [h, ...t]; }

Term
  = _ "(" @Expression ")" _
  / FuncCall
  / Identifier
  / Number
  / String

// Strings
String
  = RawString / FormattedString

RawString
  = _ '"' chars:$Char* '"' _ {
    return {
      _type: "string",
      value: chars,
    };
  }
  
FormattedString
  = _ '\'"' chars:(Format / Char)* '"' _ {
    const reduced = chars
      .reduce((acc, item) => {
        if (typeof item === 'string') {
          if (typeof acc[acc.length - 1] === 'string') {
            acc[acc.length - 1] += item;
          } else {
            acc.push(item);
          }
        } else {
          acc.push(item);
        }
        return acc;
      }, [])
      .map(x => {
        return typeof x !== 'string' ? x : {
          _type: "string",
          value: x
        };
      });

    return {
      _type: "formatted-string",
      value: reduced,
    };
  }

Format
  = "{" expression:Expression? "}" {
    return {
      _type: "format-expression",
      expression: expression,
    };
  }

Char
  = unescaped
  / "\\" sequence:(
        '"'
      / "\\"
      / "/"
      / "b" { return "\b"; }
      / "f" { return "\f"; }
      / "n" { return "\n"; }
      / "r" { return "\r"; }
      / "t" { return "\t"; }
      / "u" digits:$(HexDigit HexDigit HexDigit HexDigit) {
          return String.fromCharCode(parseInt(digits, 16));
        }
    )
    { return sequence; }

unescaped
  = [^\0-\x1F\x22\x5C]


// Numbers
Number "number"
  = HexNumber / BinNumber / OctNumber / IntegerNumber / FloatNumber

OctNumber
  = _ "0" num:$[0-7]+ _ {
    return {
      _type: "octal-number",
      match: num,
      value: parseInt(num, 8),
    };
  }
  
BinNumber
  = _ "0b" num:$[0-1]+ _ {
    return {
      _type: "binary-number",
      match: num,
      value: parseInt(num, 2),
    };
  }

HexNumber
  = _ "0x" num:$(HexDigit+) _ {
    return {
      _type: "hex-number",
      match: num,
      value: parseInt(num, 16),
    };
  }

IntegerNumber
  = _ num:$("-"? ("0" / [1-9][0-9]*)) _ {
    return {
      _type: "integer-number",
      match: num,
      value: parseInt(num),
    };
  }

FloatNumber
  = _ num:$("-"? ("0" / [1-9][0-9]*) ("." [0-9]+)? ("e" "-"? [0-9]+)?) _ {
    return {
      _type: "float-number",
      match: num,
      value: parseFloat(num),
    };
  }


// Identifier
Identifier
  = CompositeIdentifier
  / SimpleIdentifier

SimpleIdentifier
  = _ id:Ident  _ {
    return {
      _type: "simple-identifier",
      id: id
    };
  }

CompositeIdentifier
  = _ head:Ident tail:( "." @Ident )+ _ {
    return {
      _type: "composite-identifier",
      id: `${head}.${tail.join(".")}`,
      parts: [ head, ...tail ]
    };
  }

Ident
  = id:$((Alpha / Control) (Alpha / Control / Digit)*) { return id; }


// Misc
Control "control" = [_\-*+\\/^&%$#@!~=|<>\`]
Alpha "alpha" = [^ \t\n\r.,?'"|@:`~;^&*%$#=+!()\[\]/\\\\-_0-9]
HexDigit "hex" = [0-9a-fA-F]
Digit "digit" = [0-9]
EOF = [\n\x00]
__ "whitespace" = [ \t\n\r]+
_ "whitespace" = [ \t\n\r]*
