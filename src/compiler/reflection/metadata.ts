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

/**
 * An enum member's VALUE, by the same rule both emitters fold it with (D70).
 *
 * The policy is "the explicit `=> v`, else the ordinal", and it is written in three places now:
 * `JSTransformerAstVisitor.visitEnum` and `ResolveHirToCir.registerEnum` each apply it to produce a
 * NODE (one emits an expression, the other defers resolution), and this applies it to produce a
 * VALUE. They cannot share an implementation because the outputs differ in kind -- but they must not
 * disagree, so the rule is stated once here and pinned by a corpus case that gives explicit values to
 * some members and not others, which is exactly where an ordinal-vs-explicit mismatch surfaces.
 *
 * A member whose value is not a literal answers `undefined`, and the entry omits `value` rather than
 * guessing. Falling back to the ordinal would be actively WRONG -- it would disagree with what the
 * program computes -- and reflection saying "I do not know" beats reflection lying.
 */
export function enumMemberValue(keyNode: any, ordinal: number): number | string | undefined {
  const v = keyNode?.value;
  if (v === null || v === undefined) return ordinal;
  const lit = literalValueOf(v);
  return typeof lit === "boolean" ? undefined : lit;
}

/**
 * An AST node's value, if it is a LITERAL the metadata graph can carry; otherwise undefined.
 *
 * The metadata table is data emitted at startup, not code, so only a literal can reach it. Every
 * caller answers "I do not know" for anything else rather than guessing -- that posture is why a
 * non-literal enum value reports nil instead of falling back to an ordinal that would disagree with
 * what the program computes.
 *
 * A `string` node's `value` is already unquoted and unescaped by the builder, so it needs no further
 * treatment here.
 */
export function literalValueOf(node: any): string | number | boolean | undefined {
  if (!node || typeof node !== "object") return undefined;
  switch (node._type) {
    case "integer-number":
    case "float-number":
      return typeof node.value === "number" ? node.value : undefined;
    case "string":
      return typeof node.value === "string" ? node.value : undefined;
    case "boolean":
      return typeof node.value === "boolean" ? node.value : undefined;
    default:
      return undefined;
  }
}

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

  // D68 -- the declaration's own modifiers, name and role. Conditional, exactly as `generics`,
  // `implements` and `extends` are below: a declaration carrying none gains no key, so every
  // descriptor a program already printed is byte-identical unless a modifier was actually written.
  //
  // Emitted for EVERY kind rather than only classes, because a top-level `(fn :public …)` has no
  // other exposure -- visibility reaches reflection on MEMBERS (`isPublic`/`isPrivate`) and nowhere
  // else. Member-level custom modifiers are a separate question and deliberately not answered here.
  if (metadata.modifiers?.length > 0) {
    result.modifiers = metadata.modifiers.map((m: any) =>
      m.args === undefined
        ? { name: m.name, kind: m.kind }
        : { name: m.name, kind: m.kind, args: m.args }
    );
  }

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
  
  // D70 -- an enum's members, in declaration order. This is the whole entry: an enum member is a
  // compile-time constant folded below the HIR, so there is nothing at run time to describe BUT this.
  if (metadata.kind === 'enum') {
    result.members = (metadata.enumMembers ?? []).map((m: any) =>
      m.value === undefined ? { name: m.name } : { name: m.name, value: m.value }
    );
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

/**
 * Every interface a type conforms to, TRANSITIVELY -- its own `:implements`, each of those
 * interfaces' own supers, and everything inherited through the `:extends` chain.
 *
 * It reads `getAllTypeMetadata()`, the SAME channel `buildTypesMetadata` reads, so `(x :of Foo)` and
 * `(type x).implements` cannot answer differently about the same type. That is the whole reason it
 * lives in this module rather than beside the conformance predicates in `hir/extensionResolution`:
 * those read the symbol table's inferred types, which for a struct do not carry the interface list at
 * all -- the first attempt at this emitted an empty list for every type and looked like it worked.
 *
 * The CLOSURE is computed here, at compile time, and emitted as a FLAT list onto the class (JS:
 * `static __ll_interfaces`; C: `ll_class.interfaces`). The runtime type test is then a string scan
 * with no graph to walk and no symbol table to consult -- which is the only form available to it,
 * since D24 erases interfaces entirely.
 */
export function conformedInterfaceNames(context: Context, typeName: string): string[] {
  const all = context.symbolTable.getAllTypeMetadata();
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string): void => {
    if (seen.has(n)) return;
    seen.add(n);
    const m: any = all.get(n);
    if (!m) return;
    for (const i of m.implementedInterfaces ?? []) {
      if (!out.includes(i.interfaceName)) out.push(i.interfaceName);
      visit(i.interfaceName);
    }
    if (m.parentClass) visit(m.parentClass);
  };
  visit(typeName);
  return out;
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
