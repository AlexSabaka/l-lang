/* l-lang C runtime v0 -- prepended to every compiled program (single translation unit).
 *
 * Mirrors the JS runtime shim (src/compiler/runtime/RuntimeProvider.ts) on a typed target:
 *   - ll_value: the boxed-Unknown repr. Fat two-word tagged union (the settled Q1 answer):
 *     correctness-first, no int-range trap, no float boxing, trivially debuggable. Concrete static
 *     types stay native C types; ONLY Unknown-typed slots box.
 *   - Print parity: ll_console_log reproduces node's util.formatWithOptions({depth:null}) shapes
 *     ("[ 1, 2, 3 ]", "{ a: 1, b: 2 }", strings quoted inside containers, bare at top level) --
 *     the corpus goldens bake this format in.
 *   - Memory: malloc-and-leak, deliberately. Corpus programs are sub-second; a probe that debugs a
 *     garbage collector has failed its purpose.
 *   - Traps are honest: wrong-tag unbox, out-of-bounds index, missing key -> message on stderr,
 *     exit(70). Never a silent wrong answer.
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <math.h>
#include <inttypes.h>

#define LL_END INT64_MIN /* "argument omitted" sentinel for optional trailing int args (slice end) */

typedef enum {
  LL_NIL, LL_INT, LL_REAL, LL_BOOL, LL_CHAR, LL_STR, LL_VEC, LL_MAP, LL_OBJ, LL_CLOSURE
} ll_tag;

typedef struct ll_str { size_t len; char *data; } ll_str;
typedef struct ll_vec ll_vec;
typedef struct ll_map ll_map;
typedef struct ll_obj ll_obj;
typedef struct ll_closure ll_closure;

typedef struct ll_value {
  ll_tag tag;
  union {
    int64_t i;
    double d;
    bool b;
    uint32_t ch;
    ll_str *s;
    ll_vec *v;
    ll_map *m;
    ll_obj *o;
    ll_closure *fn;
  } as;
} ll_value;

struct ll_vec { size_t len, cap; ll_value *items; };
struct ll_map { size_t len, cap; ll_str **keys; ll_value *vals; };

/* -- traps --------------------------------------------------------------------------------------- */

static void ll_trap(const char *kind, const char *msg) {
  fprintf(stderr, "%s: %s\n", kind, msg);
  exit(70);
}

static void *ll_alloc(size_t n) {
  void *p = malloc(n ? n : 1);
  if (!p) ll_trap("OutOfMemory", "allocation failed");
  return p;
}

/* -- constructors -------------------------------------------------------------------------------- */

static ll_value ll_nil(void) { ll_value v; v.tag = LL_NIL; v.as.i = 0; return v; }
static ll_value ll_box_int(int64_t i) { ll_value v; v.tag = LL_INT; v.as.i = i; return v; }
static ll_value ll_box_real(double d) { ll_value v; v.tag = LL_REAL; v.as.d = d; return v; }
static ll_value ll_box_bool(bool b) { ll_value v; v.tag = LL_BOOL; v.as.b = b; return v; }
static ll_value ll_box_char(uint32_t c) { ll_value v; v.tag = LL_CHAR; v.as.ch = c; return v; }
static ll_value ll_box_str(ll_str *s) { ll_value v; v.tag = LL_STR; v.as.s = s; return v; }
static ll_value ll_box_vec(ll_vec *x) { ll_value v; v.tag = LL_VEC; v.as.v = x; return v; }
static ll_value ll_box_map(ll_map *m) { ll_value v; v.tag = LL_MAP; v.as.m = m; return v; }

static ll_str *ll_str_new(size_t len) {
  ll_str *s = (ll_str *)ll_alloc(sizeof(ll_str));
  s->len = len;
  s->data = (char *)ll_alloc(len + 1);
  s->data[len] = '\0';
  return s;
}

static ll_str *ll_str_from(const char *bytes, size_t len) {
  ll_str *s = ll_str_new(len);
  memcpy(s->data, bytes, len);
  return s;
}

static ll_str *ll_str_lit(const char *cstr) { return ll_str_from(cstr, strlen(cstr)); }

static ll_vec *ll_vec_new(size_t cap) {
  ll_vec *v = (ll_vec *)ll_alloc(sizeof(ll_vec));
  v->len = 0;
  v->cap = cap ? cap : 4;
  v->items = (ll_value *)ll_alloc(v->cap * sizeof(ll_value));
  return v;
}

static ll_vec *ll_vec_of(size_t n, ll_value *items) {
  ll_vec *v = ll_vec_new(n ? n : 4);
  for (size_t i = 0; i < n; i++) v->items[i] = items[i];
  v->len = n;
  return v;
}

static void ll_vec_grow(ll_vec *v, size_t need) {
  if (need <= v->cap) return;
  while (v->cap < need) v->cap *= 2;
  v->items = (ll_value *)realloc(v->items, v->cap * sizeof(ll_value));
  if (!v->items) ll_trap("OutOfMemory", "vector grow failed");
}

static ll_map *ll_map_new(size_t cap) {
  ll_map *m = (ll_map *)ll_alloc(sizeof(ll_map));
  m->len = 0;
  m->cap = cap ? cap : 4;
  m->keys = (ll_str **)ll_alloc(m->cap * sizeof(ll_str *));
  m->vals = (ll_value *)ll_alloc(m->cap * sizeof(ll_value));
  return m;
}

static bool ll_str_eq(const ll_str *a, const ll_str *b) {
  return a->len == b->len && memcmp(a->data, b->data, a->len) == 0;
}

static void ll_map_set(ll_map *m, ll_str *key, ll_value val) {
  for (size_t i = 0; i < m->len; i++) {
    if (ll_str_eq(m->keys[i], key)) { m->vals[i] = val; return; }
  }
  if (m->len == m->cap) {
    m->cap *= 2;
    m->keys = (ll_str **)realloc(m->keys, m->cap * sizeof(ll_str *));
    m->vals = (ll_value *)realloc(m->vals, m->cap * sizeof(ll_value));
    if (!m->keys || !m->vals) ll_trap("OutOfMemory", "map grow failed");
  }
  m->keys[m->len] = key;
  m->vals[m->len] = val;
  m->len++;
}

static ll_map *ll_map_of(size_t n, ll_str **keys, ll_value *vals) {
  ll_map *m = ll_map_new(n ? n : 4);
  for (size_t i = 0; i < n; i++) ll_map_set(m, keys[i], vals[i]);
  return m;
}

/* -- structs / classes (spec A4: the whole layer is absent from the HIR) ------------------------- */

typedef struct ll_class {
  const char *name;
  bool is_struct;          /* true = value semantics (copied); false = reference (shared) */
  size_t field_count;
  const char **field_names;
} ll_class;

struct ll_obj {
  const ll_class *cls;
  ll_value fields[];       /* boxed, in slot order */
};

static ll_value ll_box_obj(ll_obj *o) { ll_value v; v.tag = LL_OBJ; v.as.o = o; return v; }

static ll_obj *ll_unbox_obj(ll_value v) {
  if (v.tag == LL_OBJ) return v.as.o;
  ll_trap("TypeError", "expected an object");
  return NULL;
}

static ll_obj *ll_obj_new(const ll_class *cls, size_t argc, ll_value *args) {
  ll_obj *o = (ll_obj *)ll_alloc(sizeof(ll_obj) + cls->field_count * sizeof(ll_value));
  o->cls = cls;
  for (size_t i = 0; i < cls->field_count; i++) o->fields[i] = i < argc ? args[i] : ll_nil();
  return o;
}

/* -- closures (the env the HIR does not model -- spec A3) ----------------------------------------- */

struct ll_closure {
  ll_value (*fn)(void *env, int argc, ll_value *argv);
  void *env;
  int arity;
  const char *name; /* source name, for node's `[Function: name]` inspect format */
};

static ll_value ll_box_closure(ll_closure *c) { ll_value v; v.tag = LL_CLOSURE; v.as.fn = c; return v; }

/* Returns the RAW pointer (the "closure" ctype). P2 boxes it (ll_box_closure) at value boundaries. */
static ll_closure *ll_closure_make(ll_value (*fn)(void *, int, ll_value *), void *env, int arity, const char *name) {
  ll_closure *c = (ll_closure *)ll_alloc(sizeof(ll_closure));
  c->fn = fn;
  c->env = env;
  c->arity = arity;
  c->name = name;
  return c;
}

static ll_closure *ll_unbox_closure(ll_value v) {
  if (v.tag == LL_CLOSURE) return v.as.fn;
  ll_trap("TypeError", "value is not callable");
  return NULL;
}

/** Call a boxed closure value with boxed args (the uniform boxed calling convention). */
static ll_value ll_call(ll_value fn, int argc, ll_value *argv) {
  ll_closure *c = ll_unbox_closure(fn);
  return c->fn(c->env, argc, argv);
}

/* A heap cell for a mutable-captured binding, shared between the origin frame and every closure that
 * captured it (spec A5 -- the shared mutable state the HIR does not express). */
static ll_value *ll_cell(ll_value initial) {
  ll_value *cell = (ll_value *)ll_alloc(sizeof(ll_value));
  *cell = initial;
  return cell;
}

/* -- unboxing (the A6 boundary made executable: wrong tag = trap, not coercion-by-accident) ------ */

static ll_value ll_copy(ll_value v); /* fwd */

static int64_t ll_unbox_int(ll_value v) {
  if (v.tag == LL_INT) return v.as.i;
  if (v.tag == LL_REAL && v.as.d == (double)(int64_t)v.as.d) return (int64_t)v.as.d; /* JS: one number type */
  ll_trap("TypeError", "expected an Int");
  return 0;
}

static double ll_unbox_real(ll_value v) {
  if (v.tag == LL_REAL) return v.as.d;
  if (v.tag == LL_INT) return (double)v.as.i;
  ll_trap("TypeError", "expected a Real");
  return 0;
}

static bool ll_unbox_bool(ll_value v) {
  if (v.tag == LL_BOOL) return v.as.b;
  ll_trap("TypeError", "expected a Boolean");
  return false;
}

static uint32_t ll_unbox_char(ll_value v) {
  if (v.tag == LL_CHAR) return v.as.ch;
  ll_trap("TypeError", "expected a Char");
  return 0;
}

static ll_str *ll_unbox_str(ll_value v) {
  if (v.tag == LL_STR) return v.as.s;
  ll_trap("TypeError", "expected a String");
  return NULL;
}

static ll_vec *ll_unbox_vec(ll_value v) {
  if (v.tag == LL_VEC) return v.as.v;
  ll_trap("TypeError", "expected a Vector");
  return NULL;
}

static ll_map *ll_unbox_map(ll_value v) {
  if (v.tag == LL_MAP) return v.as.m;
  ll_trap("TypeError", "expected a Map");
  return NULL;
}

/* -- number formatting (JS Number-to-string: shortest round-trip) -------------------------------- */

static void ll_fmt_double(char *buf, size_t cap, double d) {
  if (isnan(d)) { snprintf(buf, cap, "NaN"); return; }
  if (isinf(d)) { snprintf(buf, cap, d < 0 ? "-Infinity" : "Infinity"); return; }
  for (int prec = 15; prec <= 17; prec++) {
    snprintf(buf, cap, "%.*g", prec, d);
    if (strtod(buf, NULL) == d) return;
  }
}

/* -- string builder ------------------------------------------------------------------------------ */

typedef struct { char *data; size_t len, cap; } ll_sb;

static void ll_sb_init(ll_sb *sb) {
  sb->cap = 64;
  sb->len = 0;
  sb->data = (char *)ll_alloc(sb->cap);
}

static void ll_sb_put(ll_sb *sb, const char *bytes, size_t n) {
  if (sb->len + n + 1 > sb->cap) {
    while (sb->len + n + 1 > sb->cap) sb->cap *= 2;
    sb->data = (char *)realloc(sb->data, sb->cap);
    if (!sb->data) ll_trap("OutOfMemory", "string builder grow failed");
  }
  memcpy(sb->data + sb->len, bytes, n);
  sb->len += n;
}

static void ll_sb_puts(ll_sb *sb, const char *cstr) { ll_sb_put(sb, cstr, strlen(cstr)); }

static ll_str *ll_sb_finish(ll_sb *sb) {
  ll_str *s = ll_str_from(sb->data, sb->len);
  free(sb->data);
  return s;
}

/* -- ToString (JS String() semantics -- what `+` concat and interpolation use) ------------------- */

static void ll_to_string_sb(ll_sb *sb, ll_value v) {
  char buf[64];
  switch (v.tag) {
    case LL_NIL: ll_sb_puts(sb, "null"); return;
    case LL_INT: snprintf(buf, sizeof buf, "%" PRId64, v.as.i); ll_sb_puts(sb, buf); return;
    case LL_REAL: ll_fmt_double(buf, sizeof buf, v.as.d); ll_sb_puts(sb, buf); return;
    case LL_BOOL: ll_sb_puts(sb, v.as.b ? "true" : "false"); return;
    case LL_CHAR: {
      char c = (char)v.as.ch;
      ll_sb_put(sb, &c, 1);
      return;
    }
    case LL_STR: ll_sb_put(sb, v.as.s->data, v.as.s->len); return;
    case LL_VEC: { /* Array.prototype.toString: comma-joined; nil elements print as nothing */
      for (size_t i = 0; i < v.as.v->len; i++) {
        if (i) ll_sb_puts(sb, ",");
        if (v.as.v->items[i].tag != LL_NIL) ll_to_string_sb(sb, v.as.v->items[i]);
      }
      return;
    }
    case LL_MAP: ll_sb_puts(sb, "[object Object]"); return;
    default: ll_sb_puts(sb, "[object]"); return;
  }
}

static ll_str *ll_to_str(ll_value v) {
  if (v.tag == LL_STR) return v.as.s;
  ll_sb sb;
  ll_sb_init(&sb);
  ll_to_string_sb(&sb, v);
  return ll_sb_finish(&sb);
}

static ll_str *ll_int_to_str(int64_t i) { return ll_to_str(ll_box_int(i)); }
static ll_str *ll_real_to_str(double d) { return ll_to_str(ll_box_real(d)); }
static ll_str *ll_bool_to_str(bool b) { return ll_str_lit(b ? "true" : "false"); }

static ll_str *ll_concat_vals(ll_value a, ll_value b) {
  ll_sb sb;
  ll_sb_init(&sb);
  ll_to_string_sb(&sb, a);
  ll_to_string_sb(&sb, b);
  return ll_sb_finish(&sb);
}

static ll_str *ll_str_concat_n(int n, ll_value *vals) {
  ll_sb sb;
  ll_sb_init(&sb);
  for (int i = 0; i < n; i++) ll_to_string_sb(&sb, vals[i]);
  return ll_sb_finish(&sb);
}

/* -- inspect (node util.formatWithOptions parity -- what console.log and the goldens use) -------- */

static bool ll_ident_like(const ll_str *s) {
  if (s->len == 0) return false;
  for (size_t i = 0; i < s->len; i++) {
    char c = s->data[i];
    bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' || c == '$' ||
              (i > 0 && c >= '0' && c <= '9');
    if (!ok) return false;
  }
  return true;
}

static void ll_inspect_sb(ll_sb *sb, ll_value v) {
  char buf[64];
  switch (v.tag) {
    case LL_NIL: ll_sb_puts(sb, "null"); return;
    case LL_INT: snprintf(buf, sizeof buf, "%" PRId64, v.as.i); ll_sb_puts(sb, buf); return;
    case LL_REAL: ll_fmt_double(buf, sizeof buf, v.as.d); ll_sb_puts(sb, buf); return;
    case LL_BOOL: ll_sb_puts(sb, v.as.b ? "true" : "false"); return;
    case LL_CHAR: {
      ll_sb_puts(sb, "'");
      char c = (char)v.as.ch;
      ll_sb_put(sb, &c, 1);
      ll_sb_puts(sb, "'");
      return;
    }
    case LL_STR:
      ll_sb_puts(sb, "'");
      ll_sb_put(sb, v.as.s->data, v.as.s->len);
      ll_sb_puts(sb, "'");
      return;
    case LL_VEC: {
      ll_vec *vec = v.as.v;
      if (vec->len == 0) { ll_sb_puts(sb, "[]"); return; }
      ll_sb_puts(sb, "[ ");
      for (size_t i = 0; i < vec->len; i++) {
        if (i) ll_sb_puts(sb, ", ");
        ll_inspect_sb(sb, vec->items[i]);
      }
      ll_sb_puts(sb, " ]");
      return;
    }
    case LL_MAP: {
      ll_map *m = v.as.m;
      if (m->len == 0) { ll_sb_puts(sb, "{}"); return; }
      ll_sb_puts(sb, "{ ");
      for (size_t i = 0; i < m->len; i++) {
        if (i) ll_sb_puts(sb, ", ");
        if (ll_ident_like(m->keys[i])) {
          ll_sb_put(sb, m->keys[i]->data, m->keys[i]->len);
        } else {
          ll_sb_puts(sb, "'");
          ll_sb_put(sb, m->keys[i]->data, m->keys[i]->len);
          ll_sb_puts(sb, "'");
        }
        ll_sb_puts(sb, ": ");
        ll_inspect_sb(sb, m->vals[i]);
      }
      ll_sb_puts(sb, " }");
      return;
    }
    case LL_CLOSURE: {
      /* node util.inspect of a function: `[Function: name]`, or `[Function (anonymous)]`. */
      const char *nm = v.as.fn->name;
      if (nm && nm[0]) {
        ll_sb_puts(sb, "[Function: ");
        ll_sb_puts(sb, nm);
        ll_sb_puts(sb, "]");
      } else {
        ll_sb_puts(sb, "[Function (anonymous)]");
      }
      return;
    }
    case LL_OBJ: {
      /* node prints a class instance as `ClassName { field: value, ... }`. */
      const ll_obj *o = v.as.o;
      ll_sb_puts(sb, o->cls->name);
      if (o->cls->field_count == 0) { ll_sb_puts(sb, " {}"); return; }
      ll_sb_puts(sb, " { ");
      for (size_t i = 0; i < o->cls->field_count; i++) {
        if (i) ll_sb_puts(sb, ", ");
        ll_sb_puts(sb, o->cls->field_names[i]);
        ll_sb_puts(sb, ": ");
        ll_inspect_sb(sb, o->fields[i]);
      }
      ll_sb_puts(sb, " }");
      return;
    }
    default: ll_sb_puts(sb, "[object]"); return;
  }
}

static void ll_console_write(FILE *out, int n, ll_value *vals) {
  ll_sb sb;
  ll_sb_init(&sb);
  for (int i = 0; i < n; i++) {
    if (i) ll_sb_puts(&sb, " ");
    if (vals[i].tag == LL_STR) {
      /* a top-level string prints bare (console.log format semantics) */
      ll_sb_put(&sb, vals[i].as.s->data, vals[i].as.s->len);
    } else {
      ll_inspect_sb(&sb, vals[i]);
    }
  }
  fwrite(sb.data, 1, sb.len, out);
  fputc('\n', out);
  free(sb.data);
}

static void ll_console_log(int n, ll_value *vals) { ll_console_write(stdout, n, vals); }
static void ll_console_error(int n, ll_value *vals) { ll_console_write(stderr, n, vals); }

/* -- equality (D9: one nil; JS number semantics across Int/Real) --------------------------------- */

static bool ll_deep_eq(ll_value a, ll_value b) {
  if (a.tag == LL_NIL || b.tag == LL_NIL) return a.tag == LL_NIL && b.tag == LL_NIL;
  bool a_num = a.tag == LL_INT || a.tag == LL_REAL;
  bool b_num = b.tag == LL_INT || b.tag == LL_REAL;
  if (a_num && b_num) {
    double x = a.tag == LL_INT ? (double)a.as.i : a.as.d;
    double y = b.tag == LL_INT ? (double)b.as.i : b.as.d;
    return x == y;
  }
  if (a.tag != b.tag) return false;
  switch (a.tag) {
    case LL_BOOL: return a.as.b == b.as.b;
    case LL_CHAR: return a.as.ch == b.as.ch;
    case LL_STR: return ll_str_eq(a.as.s, b.as.s);
    case LL_VEC: {
      if (a.as.v->len != b.as.v->len) return false;
      for (size_t i = 0; i < a.as.v->len; i++) {
        if (!ll_deep_eq(a.as.v->items[i], b.as.v->items[i])) return false;
      }
      return true;
    }
    case LL_MAP: {
      if (a.as.m->len != b.as.m->len) return false;
      for (size_t i = 0; i < a.as.m->len; i++) {
        bool found = false;
        for (size_t j = 0; j < b.as.m->len; j++) {
          if (ll_str_eq(a.as.m->keys[i], b.as.m->keys[j])) {
            if (!ll_deep_eq(a.as.m->vals[i], b.as.m->vals[j])) return false;
            found = true;
            break;
          }
        }
        if (!found) return false;
      }
      return true;
    }
    case LL_OBJ: {
      if (a.as.o->cls != b.as.o->cls) return false;
      for (size_t i = 0; i < a.as.o->cls->field_count; i++) {
        if (!ll_deep_eq(a.as.o->fields[i], b.as.o->fields[i])) return false;
      }
      return true;
    }
    default: return false;
  }
}

/* Strict (===) equality for indexOf/includes: content for primitives, identity for containers. */
static bool ll_strict_eq(ll_value a, ll_value b) {
  bool a_num = a.tag == LL_INT || a.tag == LL_REAL;
  bool b_num = b.tag == LL_INT || b.tag == LL_REAL;
  if (a_num && b_num) {
    double x = a.tag == LL_INT ? (double)a.as.i : a.as.d;
    double y = b.tag == LL_INT ? (double)b.as.i : b.as.d;
    return x == y;
  }
  if (a.tag != b.tag) return false;
  switch (a.tag) {
    case LL_NIL: return true;
    case LL_BOOL: return a.as.b == b.as.b;
    case LL_CHAR: return a.as.ch == b.as.ch;
    case LL_STR: return ll_str_eq(a.as.s, b.as.s);
    case LL_VEC: return a.as.v == b.as.v;
    case LL_MAP: return a.as.m == b.as.m;
    default: return false;
  }
}

/* -- copy (D11/CP3: shallow-at-reference, like a C# struct) --------------------------------------
 * A STRUCT is copied memberwise, RECURSING into struct-typed fields; a field holding a reference
 * (array, map, class instance, closure) copies the reference, NOT the target. Everything else -- a
 * primitive, an array, a class instance -- is returned unchanged (a value or a shared reference).
 * The elision proof differs from the deep-MVS papers precisely because the semantics are shallow. */
static ll_value ll_copy(ll_value v) {
  if (v.tag != LL_OBJ || !v.as.o->cls->is_struct) return v; /* not a struct -> value or shared ref */
  const ll_obj *src = v.as.o;
  ll_obj *dst = (ll_obj *)ll_alloc(sizeof(ll_obj) + src->cls->field_count * sizeof(ll_value));
  dst->cls = src->cls;
  for (size_t i = 0; i < src->cls->field_count; i++) dst->fields[i] = ll_copy(src->fields[i]);
  return ll_box_obj(dst);
}

/* Copy keeping the typed obj shape (for a struct-typed local/param/return slot). */
static ll_obj *ll_copy_obj(ll_obj *o) {
  return ll_unbox_obj(ll_copy(ll_box_obj(o)));
}

/* An lvalue slot into a map for `m[k] := v` -- inserts the key if absent, returns the value slot. */
static ll_value *ll_map_slot(ll_map *m, ll_value key) {
  ll_str *ks = ll_to_str(key);
  for (size_t i = 0; i < m->len; i++) {
    if (ll_str_eq(m->keys[i], ks)) return &m->vals[i];
  }
  if (m->len == m->cap) {
    m->cap *= 2;
    m->keys = (ll_str **)realloc(m->keys, m->cap * sizeof(ll_str *));
    m->vals = (ll_value *)realloc(m->vals, m->cap * sizeof(ll_value));
    if (!m->keys || !m->vals) ll_trap("OutOfMemory", "map grow failed");
  }
  m->keys[m->len] = ks;
  m->vals[m->len] = ll_nil();
  return &m->vals[m->len++];
}

/* -- indexing: partial (trap) vs total (nil) ----------------------------------------------------- */

static ll_value ll_index_vec(ll_vec *v, int64_t i) {
  if (i < 0 || (size_t)i >= v->len) ll_trap("RangeError", "vector index out of bounds");
  return v->items[i];
}

static ll_value ll_get_map(ll_map *m, ll_str *key) {
  for (size_t i = 0; i < m->len; i++) {
    if (ll_str_eq(m->keys[i], key)) return m->vals[i];
  }
  return ll_nil();
}

static ll_value ll_index_map(ll_map *m, ll_str *key) {
  for (size_t i = 0; i < m->len; i++) {
    if (ll_str_eq(m->keys[i], key)) return m->vals[i];
  }
  ll_trap("KeyError", "missing key");
  return ll_nil();
}

static ll_str *ll_index_str(ll_str *s, int64_t i) {
  if (i < 0 || (size_t)i >= s->len) ll_trap("RangeError", "string index out of bounds");
  return ll_str_from(s->data + i, 1);
}

static ll_value ll_index_dyn(ll_value base, ll_value idx) {
  switch (base.tag) {
    case LL_VEC: return ll_index_vec(base.as.v, ll_unbox_int(idx));
    case LL_MAP: return ll_index_map(base.as.m, ll_to_str(idx));
    case LL_STR: return ll_box_str(ll_index_str(base.as.s, ll_unbox_int(idx)));
    default: ll_trap("TypeError", "value is not indexable"); return ll_nil();
  }
}

/* -- builtins (the SYMBOL_MAP surface) ----------------------------------------------------------- */

static ll_value ll_get(ll_value c, ll_value k) {
  switch (c.tag) {
    case LL_VEC: {
      if (k.tag != LL_INT) return ll_nil();
      int64_t i = k.as.i;
      if (i < 0 || (size_t)i >= c.as.v->len) return ll_nil();
      return c.as.v->items[i];
    }
    case LL_MAP: return ll_get_map(c.as.m, ll_to_str(k));
    case LL_STR: {
      if (k.tag != LL_INT) return ll_nil();
      int64_t i = k.as.i;
      if (i < 0 || (size_t)i >= c.as.s->len) return ll_nil();
      return ll_box_str(ll_str_from(c.as.s->data + i, 1));
    }
    default: return ll_nil();
  }
}

static ll_value ll_elem(ll_value c, ll_value k) { return ll_get(c, k); }

static ll_value ll_head(ll_value c) {
  ll_vec *v = ll_unbox_vec(c);
  return v->len ? v->items[0] : ll_nil();
}

static ll_vec *ll_tail(ll_value c) {
  ll_vec *v = ll_unbox_vec(c);
  ll_vec *out = ll_vec_new(v->len > 1 ? v->len - 1 : 4);
  for (size_t i = 1; i < v->len; i++) out->items[out->len++] = v->items[i];
  return out;
}

static bool ll_empty(ll_value c) {
  switch (c.tag) {
    case LL_VEC: return c.as.v->len == 0;
    case LL_STR: return c.as.s->len == 0;
    case LL_MAP: return c.as.m->len == 0;
    case LL_NIL: return true;
    default: return false;
  }
}

static ll_vec *ll_list(int n, ll_value *vals) { return ll_vec_of((size_t)n, vals); }

/* -- string ops ---------------------------------------------------------------------------------- */

static int ll_str_cmp(ll_str *a, ll_str *b) {
  size_t n = a->len < b->len ? a->len : b->len;
  int c = memcmp(a->data, b->data, n);
  if (c) return c;
  return a->len < b->len ? -1 : a->len > b->len ? 1 : 0;
}

static int64_t ll_str_len(ll_str *s) { return (int64_t)s->len; }

static ll_str *ll_str_upper(ll_str *s) {
  ll_str *out = ll_str_from(s->data, s->len);
  for (size_t i = 0; i < out->len; i++) {
    if (out->data[i] >= 'a' && out->data[i] <= 'z') out->data[i] -= 32;
  }
  return out;
}

static ll_str *ll_str_lower(ll_str *s) {
  ll_str *out = ll_str_from(s->data, s->len);
  for (size_t i = 0; i < out->len; i++) {
    if (out->data[i] >= 'A' && out->data[i] <= 'Z') out->data[i] += 32;
  }
  return out;
}

static ll_str *ll_str_trim(ll_str *s) {
  size_t a = 0, b = s->len;
  while (a < b && (s->data[a] == ' ' || s->data[a] == '\t' || s->data[a] == '\n' || s->data[a] == '\r')) a++;
  while (b > a && (s->data[b - 1] == ' ' || s->data[b - 1] == '\t' || s->data[b - 1] == '\n' || s->data[b - 1] == '\r')) b--;
  return ll_str_from(s->data + a, b - a);
}

static int64_t ll_slice_clamp(int64_t i, size_t len) {
  if (i == LL_END) return (int64_t)len;
  if (i < 0) i += (int64_t)len;
  if (i < 0) i = 0;
  if (i > (int64_t)len) i = (int64_t)len;
  return i;
}

static ll_str *ll_str_slice(ll_str *s, int64_t start, int64_t end) {
  int64_t a = ll_slice_clamp(start, s->len);
  int64_t b = ll_slice_clamp(end, s->len);
  if (b < a) b = a;
  return ll_str_from(s->data + a, (size_t)(b - a));
}

static int64_t ll_str_find(ll_str *s, ll_str *needle, int64_t from) {
  if (needle->len > s->len) return -1;
  for (size_t i = (size_t)(from < 0 ? 0 : from); i + needle->len <= s->len; i++) {
    if (memcmp(s->data + i, needle->data, needle->len) == 0) return (int64_t)i;
  }
  return -1;
}

static int64_t ll_str_index_of(ll_str *s, ll_str *needle) { return ll_str_find(s, needle, 0); }

static int64_t ll_str_last_index_of(ll_str *s, ll_str *needle) {
  int64_t found = -1, at = 0;
  for (;;) {
    int64_t next = ll_str_find(s, needle, at);
    if (next < 0) return found;
    found = next;
    at = next + 1;
  }
}

static bool ll_str_includes(ll_str *s, ll_str *needle) { return ll_str_find(s, needle, 0) >= 0; }

static bool ll_str_starts_with(ll_str *s, ll_str *p) {
  return p->len <= s->len && memcmp(s->data, p->data, p->len) == 0;
}

static bool ll_str_ends_with(ll_str *s, ll_str *p) {
  return p->len <= s->len && memcmp(s->data + (s->len - p->len), p->data, p->len) == 0;
}

static ll_str *ll_str_replace(ll_str *s, ll_str *find, ll_str *repl) {
  int64_t at = ll_str_find(s, find, 0);
  if (at < 0 || find->len == 0) return s;
  ll_sb sb;
  ll_sb_init(&sb);
  ll_sb_put(&sb, s->data, (size_t)at);
  ll_sb_put(&sb, repl->data, repl->len);
  ll_sb_put(&sb, s->data + at + find->len, s->len - (size_t)at - find->len);
  return ll_sb_finish(&sb);
}

static ll_str *ll_str_replace_all(ll_str *s, ll_str *find, ll_str *repl) {
  if (find->len == 0) return s;
  ll_sb sb;
  ll_sb_init(&sb);
  size_t at = 0;
  for (;;) {
    int64_t next = ll_str_find(s, find, (int64_t)at);
    if (next < 0) break;
    ll_sb_put(&sb, s->data + at, (size_t)next - at);
    ll_sb_put(&sb, repl->data, repl->len);
    at = (size_t)next + find->len;
  }
  ll_sb_put(&sb, s->data + at, s->len - at);
  return ll_sb_finish(&sb);
}

static ll_str *ll_str_repeat(ll_str *s, int64_t n) {
  if (n < 0) ll_trap("RangeError", "repeat count must be non-negative");
  ll_sb sb;
  ll_sb_init(&sb);
  for (int64_t i = 0; i < n; i++) ll_sb_put(&sb, s->data, s->len);
  return ll_sb_finish(&sb);
}

static ll_vec *ll_str_split(ll_str *s, ll_str *sep) {
  ll_vec *out = ll_vec_new(4);
  if (sep->len == 0) {
    for (size_t i = 0; i < s->len; i++) {
      ll_vec_grow(out, out->len + 1);
      out->items[out->len++] = ll_box_str(ll_str_from(s->data + i, 1));
    }
    return out;
  }
  size_t at = 0;
  for (;;) {
    int64_t next = ll_str_find(s, sep, (int64_t)at);
    ll_vec_grow(out, out->len + 1);
    if (next < 0) {
      out->items[out->len++] = ll_box_str(ll_str_from(s->data + at, s->len - at));
      return out;
    }
    out->items[out->len++] = ll_box_str(ll_str_from(s->data + at, (size_t)next - at));
    at = (size_t)next + sep->len;
  }
}

static ll_str *ll_str_char_at(ll_str *s, int64_t i) {
  if (i < 0 || (size_t)i >= s->len) return ll_str_lit("");
  return ll_str_from(s->data + i, 1);
}

static ll_str *ll_str_concat2(ll_str *a, ll_str *b) {
  ll_sb sb;
  ll_sb_init(&sb);
  ll_sb_put(&sb, a->data, a->len);
  ll_sb_put(&sb, b->data, b->len);
  return ll_sb_finish(&sb);
}

static ll_str *ll_str_pad_start(ll_str *s, int64_t width, ll_str *pad) {
  if ((int64_t)s->len >= width || pad->len == 0) return s;
  ll_sb sb;
  ll_sb_init(&sb);
  size_t need = (size_t)width - s->len;
  while (need > 0) {
    size_t take = need < pad->len ? need : pad->len;
    ll_sb_put(&sb, pad->data, take);
    need -= take;
  }
  ll_sb_put(&sb, s->data, s->len);
  return ll_sb_finish(&sb);
}

static ll_str *ll_str_pad_end(ll_str *s, int64_t width, ll_str *pad) {
  if ((int64_t)s->len >= width || pad->len == 0) return s;
  ll_sb sb;
  ll_sb_init(&sb);
  ll_sb_put(&sb, s->data, s->len);
  size_t need = (size_t)width - s->len;
  while (need > 0) {
    size_t take = need < pad->len ? need : pad->len;
    ll_sb_put(&sb, pad->data, take);
    need -= take;
  }
  return ll_sb_finish(&sb);
}

/* -- vector ops ---------------------------------------------------------------------------------- */

static int64_t ll_vec_len(ll_vec *v) { return (int64_t)v->len; }

static int64_t ll_vec_push(ll_vec *v, ll_value x) {
  ll_vec_grow(v, v->len + 1);
  v->items[v->len++] = x;
  return (int64_t)v->len;
}

static ll_value ll_vec_pop(ll_vec *v) {
  if (v->len == 0) return ll_nil();
  return v->items[--v->len];
}

static ll_value ll_vec_shift(ll_vec *v) {
  if (v->len == 0) return ll_nil();
  ll_value first = v->items[0];
  memmove(v->items, v->items + 1, (v->len - 1) * sizeof(ll_value));
  v->len--;
  return first;
}

static int64_t ll_vec_unshift(ll_vec *v, ll_value x) {
  ll_vec_grow(v, v->len + 1);
  memmove(v->items + 1, v->items, v->len * sizeof(ll_value));
  v->items[0] = x;
  v->len++;
  return (int64_t)v->len;
}

static ll_vec *ll_vec_reverse(ll_vec *v) {
  for (size_t i = 0, j = v->len; i + 1 < j; i++, j--) {
    ll_value t = v->items[i];
    v->items[i] = v->items[j - 1];
    v->items[j - 1] = t;
  }
  return v;
}

static ll_vec *ll_vec_slice(ll_vec *v, int64_t start, int64_t end) {
  int64_t a = ll_slice_clamp(start, v->len);
  int64_t b = ll_slice_clamp(end, v->len);
  if (b < a) b = a;
  ll_vec *out = ll_vec_new((size_t)(b - a) ? (size_t)(b - a) : 4);
  for (int64_t i = a; i < b; i++) out->items[out->len++] = v->items[i];
  return out;
}

static ll_vec *ll_vec_concat(ll_vec *a, ll_vec *b) {
  ll_vec *out = ll_vec_new(a->len + b->len ? a->len + b->len : 4);
  for (size_t i = 0; i < a->len; i++) out->items[out->len++] = a->items[i];
  for (size_t i = 0; i < b->len; i++) out->items[out->len++] = b->items[i];
  return out;
}

static ll_str *ll_vec_join(ll_vec *v, ll_str *sep) {
  ll_sb sb;
  ll_sb_init(&sb);
  for (size_t i = 0; i < v->len; i++) {
    if (i) ll_sb_put(&sb, sep->data, sep->len);
    if (v->items[i].tag != LL_NIL) ll_to_string_sb(&sb, v->items[i]);
  }
  return ll_sb_finish(&sb);
}

static int64_t ll_vec_index_of(ll_vec *v, ll_value x) {
  for (size_t i = 0; i < v->len; i++) {
    if (ll_strict_eq(v->items[i], x)) return (int64_t)i;
  }
  return -1;
}

static bool ll_vec_includes(ll_vec *v, ll_value x) { return ll_vec_index_of(v, x) >= 0; }

/* -- dynamic (boxed-receiver) member dispatch -- the __ll_member mirror -------------------------- */

static int64_t ll_dyn_length(ll_value v) {
  switch (v.tag) {
    case LL_STR: return (int64_t)v.as.s->len;
    case LL_VEC: return (int64_t)v.as.v->len;
    case LL_MAP: return (int64_t)v.as.m->len;
    default: ll_trap("TypeError", "value has no length"); return 0;
  }
}

static bool ll_dyn_name_is(ll_value name, const char *lit) {
  return name.tag == LL_STR && strlen(lit) == name.as.s->len &&
         memcmp(name.as.s->data, lit, name.as.s->len) == 0;
}

/* A fully-dynamic member READ (the __ll_member mirror for field position). */
static ll_value ll_dyn_member(ll_value recv, ll_str *name) {
  if (strcmp(name->data, "length") == 0 && (recv.tag == LL_STR || recv.tag == LL_VEC)) {
    return ll_box_int(ll_dyn_length(recv));
  }
  if (recv.tag == LL_MAP) return ll_get_map(recv.as.m, name);
  ll_trap("TypeError", "value has no such member");
  return ll_nil();
}

static ll_value ll_dyn_method(int n, ll_value *vals) {
  if (n < 2) ll_trap("TypeError", "dynamic dispatch needs a receiver and a name");
  ll_value recv = vals[0], name = vals[1];
  ll_value *args = vals + 2;
  int argc = n - 2;
  /* __ll_member semantics: on a map, a zero-arg "call" of a non-function member is a field READ. */
  if (recv.tag == LL_MAP && argc == 0 && name.tag == LL_STR) {
    return ll_get_map(recv.as.m, name.as.s);
  }
  if (recv.tag == LL_STR) {
    ll_str *s = recv.as.s;
    if (ll_dyn_name_is(name, "toUpperCase")) return ll_box_str(ll_str_upper(s));
    if (ll_dyn_name_is(name, "toLowerCase")) return ll_box_str(ll_str_lower(s));
    if (ll_dyn_name_is(name, "trim")) return ll_box_str(ll_str_trim(s));
    if (ll_dyn_name_is(name, "length")) return ll_box_int((int64_t)s->len);
    if (ll_dyn_name_is(name, "slice"))
      return ll_box_str(ll_str_slice(s, argc > 0 ? ll_unbox_int(args[0]) : 0, argc > 1 ? ll_unbox_int(args[1]) : LL_END));
    if (ll_dyn_name_is(name, "indexOf")) return ll_box_int(ll_str_index_of(s, ll_unbox_str(args[0])));
    if (ll_dyn_name_is(name, "includes")) return ll_box_bool(ll_str_includes(s, ll_unbox_str(args[0])));
    if (ll_dyn_name_is(name, "startsWith")) return ll_box_bool(ll_str_starts_with(s, ll_unbox_str(args[0])));
    if (ll_dyn_name_is(name, "endsWith")) return ll_box_bool(ll_str_ends_with(s, ll_unbox_str(args[0])));
    if (ll_dyn_name_is(name, "replace")) return ll_box_str(ll_str_replace(s, ll_unbox_str(args[0]), ll_unbox_str(args[1])));
    if (ll_dyn_name_is(name, "replaceAll")) return ll_box_str(ll_str_replace_all(s, ll_unbox_str(args[0]), ll_unbox_str(args[1])));
    if (ll_dyn_name_is(name, "repeat")) return ll_box_str(ll_str_repeat(s, ll_unbox_int(args[0])));
    if (ll_dyn_name_is(name, "split")) return ll_box_vec(ll_str_split(s, ll_unbox_str(args[0])));
    if (ll_dyn_name_is(name, "charAt")) return ll_box_str(ll_str_char_at(s, ll_unbox_int(args[0])));
  }
  if (recv.tag == LL_VEC) {
    ll_vec *v = recv.as.v;
    if (ll_dyn_name_is(name, "push")) return ll_box_int(ll_vec_push(v, argc > 0 ? args[0] : ll_nil()));
    if (ll_dyn_name_is(name, "pop")) return ll_vec_pop(v);
    if (ll_dyn_name_is(name, "shift")) return ll_vec_shift(v);
    if (ll_dyn_name_is(name, "unshift")) return ll_box_int(ll_vec_unshift(v, argc > 0 ? args[0] : ll_nil()));
    if (ll_dyn_name_is(name, "reverse")) return ll_box_vec(ll_vec_reverse(v));
    if (ll_dyn_name_is(name, "length")) return ll_box_int((int64_t)v->len);
    if (ll_dyn_name_is(name, "slice"))
      return ll_box_vec(ll_vec_slice(v, argc > 0 ? ll_unbox_int(args[0]) : 0, argc > 1 ? ll_unbox_int(args[1]) : LL_END));
    if (ll_dyn_name_is(name, "concat")) return ll_box_vec(ll_vec_concat(v, ll_unbox_vec(args[0])));
    if (ll_dyn_name_is(name, "join")) return ll_box_str(ll_vec_join(v, argc > 0 ? ll_unbox_str(args[0]) : ll_str_lit(",")));
    if (ll_dyn_name_is(name, "indexOf")) return ll_box_int(ll_vec_index_of(v, args[0]));
    if (ll_dyn_name_is(name, "includes")) return ll_box_bool(ll_vec_includes(v, args[0]));
  }
  ll_trap("TypeError", "no such method on this value");
  return ll_nil();
}

/* -- generic boxed operators (the JS operator shim's NATIVE tail; user-overload registry is
 *    Phase C). JS `+` semantics: string contagion, else numeric; int-ness preserved when exact. --- */

static double ll_as_num(ll_value v) {
  if (v.tag == LL_INT) return (double)v.as.i;
  if (v.tag == LL_REAL) return v.as.d;
  ll_trap("TypeError", "expected a number");
  return 0;
}

static bool ll_both_int(ll_value a, ll_value b) { return a.tag == LL_INT && b.tag == LL_INT; }

static ll_value ll_op_add(ll_value a, ll_value b) {
  if (a.tag == LL_STR || b.tag == LL_STR) return ll_box_str(ll_concat_vals(a, b));
  if (ll_both_int(a, b)) return ll_box_int(a.as.i + b.as.i);
  return ll_box_real(ll_as_num(a) + ll_as_num(b));
}

static ll_value ll_op_sub(ll_value a, ll_value b) {
  if (ll_both_int(a, b)) return ll_box_int(a.as.i - b.as.i);
  return ll_box_real(ll_as_num(a) - ll_as_num(b));
}

static ll_value ll_op_mul(ll_value a, ll_value b) {
  if (ll_both_int(a, b)) return ll_box_int(a.as.i * b.as.i);
  return ll_box_real(ll_as_num(a) * ll_as_num(b));
}

static ll_value ll_op_div(ll_value a, ll_value b) {
  return ll_box_real(ll_as_num(a) / ll_as_num(b)); /* JS: division always yields a Real */
}

static ll_value ll_op_mod(ll_value a, ll_value b) {
  if (ll_both_int(a, b) && b.as.i != 0) return ll_box_int(a.as.i % b.as.i);
  return ll_box_real(fmod(ll_as_num(a), ll_as_num(b)));
}

static bool ll_op_lt(ll_value a, ll_value b) {
  if (a.tag == LL_STR && b.tag == LL_STR) return ll_str_cmp(a.as.s, b.as.s) < 0;
  return ll_as_num(a) < ll_as_num(b);
}

static bool ll_op_gt(ll_value a, ll_value b) {
  if (a.tag == LL_STR && b.tag == LL_STR) return ll_str_cmp(a.as.s, b.as.s) > 0;
  return ll_as_num(a) > ll_as_num(b);
}

static bool ll_op_le(ll_value a, ll_value b) { return !ll_op_gt(a, b); }
static bool ll_op_ge(ll_value a, ll_value b) { return !ll_op_lt(a, b); }

/* -- math ---------------------------------------------------------------------------------------- */

static double ll_math_sqrt(double x) { return sqrt(x); }
static double ll_math_log(double x) { return log(x); }
static double ll_math_exp(double x) { return exp(x); }
static double ll_math_sin(double x) { return sin(x); }
static double ll_math_cos(double x) { return cos(x); }
static double ll_math_tan(double x) { return tan(x); }
static double ll_math_asin(double x) { return asin(x); }
static double ll_math_acos(double x) { return acos(x); }
static double ll_math_atan(double x) { return atan(x); }
static double ll_math_atan2(double y, double x) { return atan2(y, x); }
static double ll_math_hypot(double a, double b) { return hypot(a, b); }
static double ll_math_abs(double x) { return fabs(x); }
static double ll_math_floor(double x) { return floor(x); }
static double ll_math_ceil(double x) { return ceil(x); }
static double ll_math_round(double x) { return floor(x + 0.5); } /* JS Math.round semantics */
static double ll_math_pow(double a, double b) { return pow(a, b); }
static double ll_math_min(double a, double b) { return a < b ? a : b; }
static double ll_math_max(double a, double b) { return a > b ? a : b; }

/* -- runtime type tests (D41 / spec A7). Mirrors JS __ll_is_type: Int/Real are one "number", and a
 *    generic's arguments are erased (`Int[]` tests "is an array"). Nominal class tags are Phase D. -- */
static bool ll_is_type(ll_value v, const char *name, int primitive) {
  if (primitive) {
    if (strcmp(name, "Int") == 0 || strcmp(name, "Real") == 0) return v.tag == LL_INT || v.tag == LL_REAL;
    if (strcmp(name, "String") == 0) return v.tag == LL_STR;
    if (strcmp(name, "Boolean") == 0 || strcmp(name, "Bool") == 0) return v.tag == LL_BOOL;
    if (strcmp(name, "Char") == 0) return v.tag == LL_CHAR;
    if (strcmp(name, "Void") == 0) return v.tag == LL_NIL;
    return false;
  }
  if (strcmp(name, "Array") == 0) return v.tag == LL_VEC;
  if (strcmp(name, "Map") == 0) return v.tag == LL_MAP;
  /* Nominal struct/class identity: the descriptor carries the source name. */
  if (v.tag == LL_OBJ) return strcmp(v.as.o->cls->name, name) == 0;
  return false;
}

/* -- number parsing / predicates (host globals: Number/parseInt/parseFloat/isNaN/isFinite) -------- */

static double ll_str_to_double(const ll_str *s, bool *ok) {
  char *buf = (char *)ll_alloc(s->len + 1);
  memcpy(buf, s->data, s->len);
  buf[s->len] = '\0';
  char *end = NULL;
  double d = strtod(buf, &end);
  /* JS Number(): leading/trailing spaces allowed; otherwise the WHOLE string must parse. */
  while (end && (*end == ' ' || *end == '\t' || *end == '\n' || *end == '\r')) end++;
  *ok = end && *end == '\0' && s->len > 0;
  return d;
}

static ll_value ll_number(ll_value v) {
  if (v.tag == LL_INT || v.tag == LL_REAL) return v;
  if (v.tag == LL_BOOL) return ll_box_real(v.as.b ? 1.0 : 0.0);
  if (v.tag == LL_NIL) return ll_box_real(0.0);
  if (v.tag == LL_STR) {
    bool ok = false;
    double d = ll_str_to_double(v.as.s, &ok);
    if (!ok) return ll_box_real(NAN);
    return d == (double)(int64_t)d ? ll_box_int((int64_t)d) : ll_box_real(d);
  }
  return ll_box_real(NAN);
}

static ll_value ll_parse_int(ll_value v) {
  ll_str *s = v.tag == LL_STR ? v.as.s : ll_to_str(v);
  char *buf = (char *)ll_alloc(s->len + 1);
  memcpy(buf, s->data, s->len);
  buf[s->len] = '\0';
  char *end = NULL;
  long long n = strtoll(buf, &end, 10);
  if (end == buf) return ll_box_real(NAN);
  return ll_box_int((int64_t)n);
}

static ll_value ll_parse_float(ll_value v) {
  ll_str *s = v.tag == LL_STR ? v.as.s : ll_to_str(v);
  char *buf = (char *)ll_alloc(s->len + 1);
  memcpy(buf, s->data, s->len);
  buf[s->len] = '\0';
  char *end = NULL;
  double d = strtod(buf, &end);
  if (end == buf) return ll_box_real(NAN);
  return ll_box_real(d);
}

static bool ll_is_nan(ll_value v) {
  if (v.tag == LL_REAL) return isnan(v.as.d);
  if (v.tag == LL_INT) return false;
  return true; /* JS isNaN coerces non-numbers via Number(); a non-numeric string -> NaN -> true */
}

static bool ll_is_finite(ll_value v) {
  if (v.tag == LL_REAL) return isfinite(v.as.d);
  if (v.tag == LL_INT) return true;
  return false;
}
