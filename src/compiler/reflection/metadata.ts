import type { Context } from "../Context";
import { TypeChecker } from "../types/TypeChecker";

/**
 * The reflection metadata graph -- ONE builder, both backends (D54).
 *
 * D54 rules that the backend emits the graph but the accessor SHAPE is the spec, not per-backend.
 * This used to live inside the JS transformer, which meant the C backend had no way to produce the
 * same answer: `ll_class` carried only a name and a parent, so `(type p)` on C returned a stub and
 * `(type-by-name "add")` returned nil outright. Two builders would have been two shapes waiting to
 * drift -- the failure A-0 exists to prevent -- so there is one, and it depends on nothing but the
 * symbol table.
 */

export function renderMetadataType(t: any): string {
  if (!t) return 'Any';
  if ((t.kind === 'struct' || t.kind === 'class' || t.kind === 'interface') && t.name) {
    return t.optional ? `${t.name}?` : t.name;
  }
  return TypeChecker.formatType(t);
}

function convertCodegenMetadataToRuntimeFormat(metadata: any): Record<string, any> {
  const renderType = (t: any) => renderMetadataType(t);

  const result: any = {
    name: metadata.typeName,
    kind: metadata.kind,
  };
  
  // An interface takes the same path (Zja): it has `detailedMembers` and `methodSignatures` and
  // nothing else, and the arms it lacks -- `constructor`, `extends` -- are each already gated on the
  // field being there. Erased at run time (D24), so there is nothing else to say about it.
  if (metadata.kind === 'class' || metadata.kind === 'struct' || metadata.kind === 'interface') {
    result.properties = metadata.detailedMembers?.filter((m: any) => !m.isOperator).map((m: any) => ({
      name: m.name,
      type: renderType(m.type),
      isPublic: m.visibility === 'public',
      isPrivate: m.visibility === 'private',
      isStatic: m.isStatic || false
    })) || [];

    result.methods = Array.from(metadata.methodSignatures?.values() || []).map((method: any) => ({
      name: method.name,
      params: method.parameters.map((p: any) => ({
        name: p.name,
        type: renderType(p.type)
      })),
      returns: renderType(method.returnType)
    }));

    if (metadata.constructorSignature) {
      result.constructor = {
        params: metadata.constructorSignature.parameters.map((p: any) => ({
          name: p.name,
          type: renderType(p.type),
          hasDefault: p.hasDefault
        })),
        requiredCount: metadata.constructorSignature.requiredCount
      };
    }
    
    if (metadata.parentClass) {
      result.extends = metadata.parentClass;
    }
    
    // `generics` before `implements`: a class is `Container<T> :implements GenericContainer<T>`,
    // and the metadata is printed by `(type x)` through console.log, which walks insertion order.
    // The golden reads in declaration order; so does this.
    if (metadata.typeParameters?.length > 0) {
      result.generics = metadata.typeParameters.map((tp: any) => tp.name);
    }

    if (metadata.implementedInterfaces?.length > 0) {
      result.implements = metadata.implementedInterfaces.map((iface: any) => iface.interfaceName);
    }
  }
  
  if (metadata.kind === 'function') {
    const methodSig = Array.from(metadata.methodSignatures?.values() || [])[0] as any;
    if (methodSig && methodSig.parameters && methodSig.returnType) {
      result.params = methodSig.parameters.map((p: any) => ({
        name: p.name,
        type: renderType(p.type)
      }));
      result.returns = renderType(methodSig.returnType);
    }
  }
  
  // A DELIBERATE CONSTANT, not a read. `nullable` describes a TYPE ENTRY -- a class, struct,
  // interface, function, or primitive -- and a type DECLARATION has no optionality: `?` is a
  // property of a SLOT (a param, a return, a member), and those already carry it in their rendered
  // type string (`returns: "String?"`). So there is nothing here for `nullable` to read, and it can
  // only ever be false.
  //
  // It used to say `= !!metadata.optional` under a comment claiming "it reads the real thing now" --
  // but `metadata` is a CodegenMetadata, which has no `optional` field (that lives on InferredType),
  // so the read was always `undefined` and the flag always false. `metadata: any` is why nothing
  // objected. The value is unchanged; the lie is gone. The primitives seed (above) already hardcodes
  // this same `false`. The KEY stays -- `nullable: false` is public reflection output pinned by
  // 02_fn_types.expect; whether to keep a permanently-false field at all is a separate call.
  result.nullable = false;

  return result;
}

export function buildTypesMetadata(context: Context): Record<string, any> {
  const out: Record<string, any> = {};
  // The six primitives, which the table has never contained (Zi).
  //
  // It is `getAllClassMetadata()` + `getAllFunctionMetadata()` and nothing else, both gated on
  // `inferredType.kind`, and no pass mints a symbol or a `codegenMetadata` for a primitive. So
  // `(type 5)` fell through every arm of the runtime and answered `{kind:'unknown'}` -- there was no
  // number arm at all -- and `(type-by-name "Int")` found nothing. A reflection API in which the six
  // most common types in the language do not exist.
  //
  // Registered FIRST, so a user type of the same name wins the key rather than being shadowed by us.
  // Minimal on purpose: `String.length` and friends are a members question (Ja), not a name question.
  for (const p of ["Int", "Real", "String", "Char", "Boolean", "Void", "Nil"]) {
    out[p] = { name: p, kind: "primitive", nullable: false };
  }

  // The three types every program can PRODUCE but no program DECLARES (Zi's gap, one level out).
  //
  // Zi seeded the primitives because `(type 5)` had no arm to land on. The same hole was left open
  // one type-constructor further out: `(type [1 2 3])`, `(type {:a 1})` and `(type f)` all reached a
  // lookup for a name that was in no table, so each backend answered from its own FALLBACK -- and the
  // fallbacks are where the two runtimes are least alike. JS reported a map as `Object` (the host's
  // name for it, not l-lang's) with the map's own KEYS as its `properties`, and an array with its
  // INDICES as `properties` -- `Object.keys` showing through, the same way `null` showed through
  // before D55. C reported `{kind:"unknown"}` for both. One entry each ends it: the name is decided
  // here, once, and both backends now find it rather than invent it.
  //
  // `container` is a KIND, not a stretch of `primitive`: D53 makes Array and Map floor
  // representations with their own contract, and calling them primitive would say they have none. A
  // container's ELEMENTS are deliberately not its `properties` -- `(type v)` answers what v IS, and
  // `[1 2 3]` is not a type with three fields called "0", "1" and "2".
  out["Array"] = { name: "Array", kind: "container", nullable: false };
  out["Map"] = { name: "Map", kind: "container", nullable: false };
  // The type of a function VALUE whose name reaches no declaration -- a lambda. A declared function
  // has its own entry (params, returns) and wins the lookup before this is reached.
  out["Function"] = { name: "Function", kind: "function", nullable: false };

  // Every type with codegen metadata, minus the host's ambient globals -- one question, one getter
  // (Zja/Zjb). This was two calls filtering on `kind`, which is why an interface could have a shape
  // and still never reach the table.
  for (const [name, metadata] of context.symbolTable.getAllTypeMetadata().entries()) {
    out[name] = convertCodegenMetadataToRuntimeFormat(metadata);
  }


  return out;
}
