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
#include <time.h>
#include <setjmp.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>

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

/* Try to raise this trap as a CATCHABLE l-lang error; returns only if it could not. Defined once the
 * handler stack and the class registry exist -- see the long note at its definition. */
static void ll_trap_as_error(const char *kind, const char *msg);

static void ll_trap(const char *kind, const char *msg) {
  ll_trap_as_error(kind, msg); /* does not return if it threw */
  fprintf(stderr, "%s: %s\n", kind, msg);
  exit(70);
}

/* An out-of-range container index, formatted exactly as the JS shim formats it. Static buffer: this
 * is the last thing that happens before the trap either unwinds or exits, so there is no reentrancy to
 * worry about, and it must not allocate -- allocation is a thing that can itself trap. */
static void ll_trap_index(int64_t i, size_t len) {
  static char buf[96];
  snprintf(buf, sizeof buf, "IndexOutOfRange: %lld (length %zu)", (long long)i, len);
  ll_trap("RangeError", buf);
}


static void *ll_alloc(size_t n) {
  void *p = malloc(n ? n : 1);
  if (!p) ll_trap("OutOfMemory", "allocation failed");
  return p;
}

/* -- the GC heap (D59, step 1: accounting) ---------------------------------------------------------
 *
 * TWO HEAPS, and the split is the point of this layer.
 *
 *   THE GC HEAP   -- everything a running program can still reach: strings, vectors, maps, objects,
 *                    closures, mutable-capture cells, and the backing arrays of the containers.
 *                    Allocated through `ll_gc_alloc`, headered, threaded onto one list, and never
 *                    freed by hand. This is what a collector will trace and sweep.
 *
 *   RUNTIME SCRATCH -- string builders, the cycle-detection set, parse buffers. Deterministically
 *                    freed by the code that made them, invisible to any program, and never a root or
 *                    a referent. It stays on bare `ll_alloc`/`free`.
 *
 * Drawing that line FIRST is what keeps the collector honest later: a sweep over the whole malloc
 * arena would have to decide what a `char*` buffer inside `ll_to_str` is, and the answer would be a
 * guess. Here the question never arises -- scratch is not on the list.
 *
 * THE HEADER carries KIND (what the payload is, hence how to trace it), SIZE, a MARK bit, and the
 * list link. Kind is recorded at the allocation site because that is the only place it is known:
 * `ll_alloc` sees a byte count, and `v->items` and `m->vals` are both "an array of ll_value" only
 * from where they are created. D59's premise that "every shape carries its own layout" holds for
 * `ll_obj`/`ll_vec`/`ll_map` and does NOT hold for the raw arrays hanging off them, nor for a
 * closure's env -- which is why the kind tag exists rather than a tag-dispatch on the pointer.
 *
 * Nothing collects yet. This step makes the heap MEASURABLE and gives the mark phase somewhere to
 * put a bit; `LL_GC_STATS=1` dumps the census at exit, which is what `test/memory.ts` reads. */
typedef enum {
  LL_H_STR,      /* ll_str header (its `data` is a separate LL_H_BYTES block) */
  LL_H_BYTES,    /* raw bytes -- no references inside, nothing to trace */
  LL_H_VEC,      /* ll_vec header (its `items` is a separate LL_H_VALUES block) */
  LL_H_MAP,      /* ll_map header (its `keys`/`vals` are separate blocks) */
  LL_H_OBJ,      /* ll_obj: cls->field_count boxed fields, in slot order */
  LL_H_CLOSURE,  /* ll_closure: its `env` is a separate block, LAYOUT NOT YET KNOWN (see D59 note) */
  LL_H_CELL,     /* one ll_value -- a mutable binding captured by reference */
  LL_H_VALUES,   /* an array of ll_value (a vec's items, a map's vals) */
  LL_H_STRS,     /* an array of ll_str* (a map's keys) */
  LL_H_CURSOR,   /* ll_cursor_env: one ll_value plus an index */
  LL_H__COUNT
} ll_hkind;

static const char *const LL_HKIND_NAME[LL_H__COUNT] = {
  "str", "bytes", "vec", "map", "obj", "closure", "cell", "values", "strs", "cursor"
};

typedef struct ll_header {
  struct ll_header *next;
  size_t size;      /* payload bytes, excluding this header */
  uint8_t kind;
  uint8_t mark;     /* reserved for the mark phase; always 0 for now */
} ll_header;

static ll_header *ll_heap = (ll_header *)0;   /* every GC allocation, newest first */
static size_t ll_heap_bytes = 0;              /* live payload bytes (nothing is freed yet) */
static size_t ll_heap_count = 0;
static size_t ll_heap_by_kind[LL_H__COUNT];
static size_t ll_bytes_by_kind[LL_H__COUNT];

#define LL_HDR(p) (((ll_header *)(p)) - 1)
#define LL_PAYLOAD(h) ((void *)((h) + 1))

static void *ll_gc_alloc(size_t n, ll_hkind kind) {
  ll_header *h = (ll_header *)malloc(sizeof(ll_header) + (n ? n : 1));
  if (!h) ll_trap("OutOfMemory", "allocation failed");
  h->next = ll_heap;
  h->size = n;
  h->kind = (uint8_t)kind;
  h->mark = 0;
  ll_heap = h;
  ll_heap_bytes += n;
  ll_heap_count++;
  ll_heap_by_kind[kind]++;
  ll_bytes_by_kind[kind] += n;
  return LL_PAYLOAD(h);
}

/* Grow a GC block in place. The header moves with it, so the LIST has to be repaired: `realloc` may
 * return a different address, and the previous node's `next` still points at the old one. Walking to
 * find the predecessor is O(n) per grow, which is why containers double their capacity -- and why
 * this is the only mutation the list supports. */
static void *ll_gc_realloc(void *p, size_t n) {
  ll_header *old = LL_HDR(p);
  size_t was = old->size;
  ll_hkind kind = (ll_hkind)old->kind;
  ll_header **link = &ll_heap;
  while (*link && *link != old) link = &(*link)->next;
  ll_header *h = (ll_header *)realloc(old, sizeof(ll_header) + (n ? n : 1));
  if (!h) ll_trap("OutOfMemory", "reallocation failed");
  h->size = n;
  if (*link == old) *link = h;   /* the block moved: re-point whoever referenced it */
  ll_heap_bytes += n - was;
  ll_bytes_by_kind[kind] += n - was;
  return LL_PAYLOAD(h);
}

/* The census, for `test/memory.ts`. Behind an env var because it is a diagnostic, not a feature:
 * D59 keeps `:gc`/`:stack`/`:manual` reserved, and this deliberately adds no language surface. */
static void ll_gc_report(void) {
  if (!getenv("LL_GC_STATS")) return;
  fprintf(stderr, "ll_gc: blocks=%zu bytes=%zu\n", ll_heap_count, ll_heap_bytes);
  for (int k = 0; k < LL_H__COUNT; k++) {
    if (ll_heap_by_kind[k]) {
      fprintf(stderr, "ll_gc:   %-8s blocks=%zu bytes=%zu\n",
              LL_HKIND_NAME[k], ll_heap_by_kind[k], ll_bytes_by_kind[k]);
    }
  }
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
  ll_str *s = (ll_str *)ll_gc_alloc(sizeof(ll_str), LL_H_STR);
  s->len = len;
  s->data = (char *)ll_gc_alloc(len + 1, LL_H_BYTES);
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
  ll_vec *v = (ll_vec *)ll_gc_alloc(sizeof(ll_vec), LL_H_VEC);
  v->len = 0;
  v->cap = cap ? cap : 4;
  v->items = (ll_value *)ll_gc_alloc(v->cap * sizeof(ll_value), LL_H_VALUES);
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
  v->items = (ll_value *)ll_gc_realloc(v->items, v->cap * sizeof(ll_value));
  if (!v->items) ll_trap("OutOfMemory", "vector grow failed");
}

static ll_map *ll_map_new(size_t cap) {
  ll_map *m = (ll_map *)ll_gc_alloc(sizeof(ll_map), LL_H_MAP);
  m->len = 0;
  m->cap = cap ? cap : 4;
  m->keys = (ll_str **)ll_gc_alloc(m->cap * sizeof(ll_str *), LL_H_STRS);
  m->vals = (ll_value *)ll_gc_alloc(m->cap * sizeof(ll_value), LL_H_VALUES);
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
    m->keys = (ll_str **)ll_gc_realloc(m->keys, m->cap * sizeof(ll_str *));
    m->vals = (ll_value *)ll_gc_realloc(m->vals, m->cap * sizeof(ll_value));
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

/* A named method in a class's dynamic-dispatch table: the source name -> a BOXED-convention adapter
 * `(self, argc, argv)` that unboxes to the typed method and boxes the result. The vtable the JS
 * backend never needs (it dispatches on the JS object); a typed target must carry it explicitly. */
typedef struct ll_method_entry {
  const char *name;
  ll_value (*fn)(ll_value self, int argc, ll_value *argv);
} ll_method_entry;

typedef struct ll_class {
  const char *name;
  bool is_struct;          /* true = value semantics (copied); false = reference (shared) */
  size_t field_count;
  const char **field_names;
  const char *parent;      /* `:extends` base name, or NULL (for reflection) */
  size_t method_count;     /* dynamic-dispatch table (statically-unknown receivers) */
  const ll_method_entry *methods;
  /* The TRANSITIVE `:implements` closure. D24 erases interfaces, so this list is the only thing that
     can answer `(x :of SomeInterface)` at run time -- without it the test walked the `:extends` chain
     alone and answered false for every interface, including ones the checker had verified
     (gap ledger 14.1). Flat because the closure is computed at compile time. */
  size_t interface_count;
  const char **interfaces;
  /* D58: this class is a GENERATOR's frame type, and `gen_step` resumes it.
   *
   * These two fields are the whole of a generator's runtime identity, and they are read in exactly
   * four places: `ll_iter` (an Iterator IS an Iterable -- answer the instance), `ll_next` (call the
   * step directly, rather than walking the method table by name once per element), `ll_inspect`
   * (`#<generator fibs>` instead of `fibs{...}`) and `ll_type` (kind "generator"). `field_count`
   * still describes the frame, so `ll_copy_obj` and everything else that walks fields keeps working
   * without knowing what a generator is.
   *
   * Printing the frame would leak the state number and the spilled locals into user-facing output,
   * which is the leak FLOOR.md's F.7/F.8 amendment already rejected for lambdas. */
  bool is_gen;
  ll_value (*gen_step)(struct ll_obj *frame);
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
  ll_obj *o = (ll_obj *)ll_gc_alloc(sizeof(ll_obj) + cls->field_count * sizeof(ll_value), LL_H_OBJ);
  o->cls = cls;
  for (size_t i = 0; i < cls->field_count; i++) o->fields[i] = i < argc ? args[i] : ll_nil();
  return o;
}

/* The class registry (defined by the emitted module) -- reflection walks it by name. */
extern ll_class *__ll_class_registry[];
extern size_t __ll_class_count;
static const ll_class *ll_class_by_name(const char *name); /* fwd: used by dynamic dispatch below */

/* -- exceptions + unwinding: try/catch/finally/throw over a unified `ll_frame` handler stack, walked by
 * ONE `ll_unwind` primitive (native-only; JS gets this free via a real try/finally). A `try` installs a
 * CLEANUP frame per `finally` (an inline pad longjmp'd into) and a CATCH frame per catch chain; `throw`
 * routes through `ll_unwind`, which runs each intervening CLEANUP finally then lands at the nearest CATCH
 * (or prints "Uncaught ..." and exits 70). The D47 restart lowering (Cr-1) reuses the SAME stack + the
 * SAME primitive: `ll_unwind(RESTART)` runs the same CLEANUP finallys while SKIPPING the CATCH frames. -- */

typedef enum { LL_CATCH, LL_CLEANUP, LL_HANDLER, LL_RESTART, LL_BOUNDARY } ll_kind;
typedef enum { LL_UNWIND_NONE = 0, LL_UNWIND_THROW, LL_UNWIND_RESTART, LL_UNWIND_RETURN } ll_unwind_mode;

/* The unified handler-stack frame. `err` doubles as the unwind payload. A CLEANUP frame with dtor!=NULL is
 * a function-cleanup (D15 :destructor) called DIRECTLY during the walk; dtor==NULL is a pad-cleanup (inline
 * `finally`) longjmp'd into. The HANDLER/RESTART fields back the D47 restart lowering (Cr-1). */
typedef struct ll_frame {
  ll_kind kind;
  jmp_buf buf;
  ll_value err;
  struct ll_frame *prev;
  int pending;              /* CLEANUP resume state (an ll_unwind_mode); NONE on a structured exit */
  struct ll_frame *target;  /* the frame a transfer is aimed at (RESTART/BOUNDARY -- Cr-1) */
  int which;               /* RESTART: chosen restart index; RETURN: return/break/continue code (Cr-1) */
  void (*dtor)(ll_value);  /* CLEANUP: non-NULL = function-cleanup (D15), NULL = pad-cleanup (finally) */
  ll_value self;           /* CLEANUP: the dtor's argument */
  /* HANDLER: the ordered clause list (source order; first match wins) -- Cr-1. */
  const char **cond_types;
  ll_value (**handlers)(void *, ll_value);
  void *henv;
  size_t clause_count;
  int active;              /* 0 IFF this handler is currently executing on the C stack (re-entry guard) */
  /* RESTART: the offered restart names -- Cr-1. */
  const char **names;
  size_t name_count;
  int exit_mode;           /* BOUNDARY: distinguishes return vs break vs continue landings -- Cr-1 */
} ll_frame;

static ll_frame *ll_handler_top = 0;

/* An exception ran off the top of the handler stack: mirror node's "Uncaught <message>" then exit 70. */
static void ll_uncaught(ll_value err) {
  const char *msg = "exception";
  if (err.tag == LL_OBJ) {
    const ll_class *cls = err.as.o->cls;
    for (size_t i = 0; i < cls->field_count; i++) {
      if (strcmp(cls->field_names[i], "message") == 0 && err.as.o->fields[i].tag == LL_STR) {
        msg = err.as.o->fields[i].as.s->data;
      }
    }
    fprintf(stderr, "Uncaught %s: %s\n", cls->name, msg);
  } else if (err.tag == LL_STR) {
    fprintf(stderr, "Uncaught %s\n", err.as.s->data);
  } else {
    fprintf(stderr, "Uncaught exception\n");
  }
  exit(70);
}

/* The ONE unwind primitive. Walk `from` outward: at a CLEANUP frame run its finalizer (a direct dtor call,
 * or -- for an inline `finally` -- longjmp into its pad, which runs the finally then RESUMES this walk); at
 * a CATCH frame (THROW only) longjmp into the emitted type-filter/rethrow pad. Off the end with no CATCH
 * => uncaught. Each CLEANUP-pad longjmp collapses the C stack back to the user frame before the pad resumes
 * ll_unwind, so the walk never deep-recurses. `target`/`which` + the RESTART/RETURN modes are threaded for
 * Cr-1 (unused on the THROW path today). */
static void ll_unwind(ll_frame *from, ll_unwind_mode mode, ll_frame *target, ll_value payload, int which) {
  for (ll_frame *f = from; f; f = f->prev) {
    if (f == target && mode != LL_UNWIND_THROW) {
      /* RESTART/RETURN destination: intervening CLEANUP finallys have already run on the way here. */
      f->err = payload; f->which = which;
      longjmp(f->buf, 1); /* into the RESTART pad's else-branch (dispatches on which) */
    }
    if (f->kind == LL_CLEANUP) {
      if (f->dtor) { ll_handler_top = f->prev; f->dtor(f->self); continue; } /* D15 function-cleanup (Cr-1) */
      f->pending = mode; f->err = payload; f->target = target; f->which = which;
      longjmp(f->buf, 1); /* into the inline finally pad; runs `finally`, then resumes ll_unwind (any mode) */
    }
    if (f->kind == LL_CATCH && mode == LL_UNWIND_THROW) {
      f->err = payload;
      longjmp(f->buf, 1); /* into the emitted catch-filter/rethrow pad */
    }
    /* LL_HANDLER / non-target LL_RESTART / LL_BOUNDARY: not a landing for this transfer -- skipped. */
  }
  if (mode == LL_UNWIND_THROW) ll_uncaught(payload);
  else ll_trap("ControlError", "unwind ran off the stack with no target (invoke-restart / return)");
}

/* `throw` is a thin unwind: hand the payload to ll_unwind in THROW mode. */
static void ll_throw(ll_value err) {
  ll_unwind(ll_handler_top, LL_UNWIND_THROW, 0, err, 0);
}

/* A DATA ERROR IS CATCHABLE; A CONTRACT VIOLATION IS NOT.
 *
 * `ll_trap` used to be `fprintf` + `exit(70)` unconditionally, so an index out of bounds KILLED the
 * process on C while the same program on JS threw an ordinary `Error` a `catch` could handle.
 * `11-comptime/01_comptime_table` is the corpus case: its `:safe` decorator catches and answers -1,
 * which worked on one backend and died at exit 70 on the other.
 *
 * THE LINE (ruled): an index is DATA the program received, so it is catchable; a REFINEMENT is a
 * CONTRACT the author declared, so violating it stays fatal (D46 amend / P3c-1b-ii). That split needed
 * no work here -- `ll_refine_check_int`/`_real` do their own `fprintf` + `exit(1)` and never route
 * through `ll_trap`, so they are already on the other side of the line.
 *
 * The kind string IS the class name, so there is no mapping table to keep in step: the D62 tower
 * declares `TypeError`, `RangeError`, `ValueError` and `KeyError` as l-lang classes, and
 * `ll_class_by_name` finds whichever the emitted module actually contains. A kind with no class simply
 * stays fatal rather than being reported as something it is not.
 *
 * FOUR CONDITIONS BEFORE THROWING, each of which would otherwise turn a bad situation into a worse one:
 *
 *   * NO HANDLER INSTALLED -> exit as before. Throwing with nothing to catch it would unwind to the
 *     top and lose the message that says what went wrong.
 *   * OutOfMemory and ControlError stay FATAL. Building the error object ALLOCATES, which is precisely
 *     what failed for OutOfMemory; and a ControlError is a broken internal invariant, not data the
 *     program can be expected to handle.
 *   * RE-ENTRANCY GUARD. Constructing the error can itself trap; without the flag that recurses until
 *     the stack runs out, replacing a clear message with a crash.
 *   * NO SUCH CLASS -> exit. A program that never imported the tower has no `RangeError` to throw. */
static int ll_trapping = 0;

static void ll_trap_as_error(const char *kind, const char *msg) {
  if (!ll_handler_top) return;
  if (ll_trapping) return;
  if (strcmp(kind, "OutOfMemory") == 0 || strcmp(kind, "ControlError") == 0) return;
  const ll_class *cls = ll_class_by_name(kind);
  if (!cls) return;
  ll_trapping = 1;
  ll_value m = ll_box_str(ll_str_lit(msg));
  ll_obj *o = ll_obj_new(cls, 1, &m);
  ll_trapping = 0;
  ll_throw(ll_box_obj(o));
}

/* ================================================================================================
 * D47 CONDITIONS / RESTARTS -- the resumable kernel (Cr-1, complete).
 *
 * The unified ll_frame + ll_unwind stack above (Cr-0) carries both mechanisms: `signal` walks the
 * LL_HANDLER frames IN PLACE (an ordinary C call, NO longjmp -- the property that makes resumption
 * possible); `invoke-restart` performs a non-local transfer to a marked LL_RESTART frame via
 * ll_unwind(RESTART), which -- crucially -- runs the intervening CLEANUP finallys exactly as a
 * throw does.
 * ============================================================================================== */

static bool ll_is_type(ll_value v, const char *name, int primitive); /* defined with the D41 type tests below */
static ll_value ll_dyn_method(int n, ll_value *vals); /* fwd: the display path's Formattable dispatch */
static ll_str *ll_display_str(ll_value v); /* fwd: interpolation renders each hole via display */

/* (signal <cond>) -- walk the LL_HANDLER frames innermost->outermost IN PLACE, trying every matching
 * clause in SOURCE order (first-written gets first crack) with the frame inert while one runs
 * (re-entry guard -- SIMPLIFIED from CL: only THIS frame is inert; handlers inner to it stay
 * eligible). A handler that RETURNS declines: its value is discarded and the walk continues at the
 * NEXT HANDLER -- the next matching clause of this same frame, then outward (D47: "decline -> next
 * handler"), so a specific clause can hand off to a general one written after it. All decline => nil
 * (an unhandled signal is NOT an error). A handler that transfers (invoke-restart / throw) diverges
 * through ll_unwind; the pad-CLEANUP below re-arms the frame as the transfer passes the signal
 * point -- the dynamic-extent restore a raw longjmp would otherwise skip (without it, a recovered
 * handle frame would stay inert and silently miss every later signal). */
static ll_value ll_signal(ll_value cond) {
  for (ll_frame *f = ll_handler_top; f; f = f->prev) {
    if (f->kind != LL_HANDLER || !f->active) continue;
    for (size_t i = 0; i < f->clause_count; i++) {
      if (!ll_is_type(cond, f->cond_types[i], 0)) continue;
      /* The re-arm pad: the same pad-CLEANUP protocol an emitted `finally` uses, its "finalizer"
       * being `f->active = 1` -- so the guard restores on BOTH exits (decline and divergence).
       * setjmp-safety (C11 7.13.2.1p3): f/i are unmodified between setjmp and any longjmp ->
       * determinate, no volatile needed. `pad` itself IS modified in between (ll_unwind writes
       * pending/err/target/which through the pointer), as is every emitted ll_frame -- but a frame's
       * address escapes to an external function (ll_handler_top = &pad), which forces it to memory on
       * any real compiler; qualifying it would mean threading `volatile ll_frame*` through every
       * runtime signature for no measured gain. USER locals get no such guarantee, so the emitter
       * volatile-qualifies the clobberable ones (see codegen/c/volatiles.ts). */
      ll_frame pad; pad.kind = LL_CLEANUP; pad.dtor = 0; pad.pending = LL_UNWIND_NONE;
      pad.prev = ll_handler_top; ll_handler_top = &pad;
      if (setjmp(pad.buf) == 0) {
        f->active = 0;
        (void)f->handlers[i](f->henv, cond); /* a RETURN is a decline; the value is discarded */
        ll_handler_top = pad.prev; f->active = 1;
      } else {
        ll_handler_top = pad.prev; f->active = 1;
        ll_unwind(pad.prev, pad.pending, pad.target, pad.err, pad.which); /* resume; diverges */
      }
      /* declined -- fall through to this frame's NEXT matching clause, then to the outer frames */
    }
  }
  return ll_nil();
}

/* (invoke-restart :name args) -- find the NEWEST LL_RESTART frame offering `name` and ll_unwind to it
 * (mode=RESTART); no match is a ControlError (an error, distinct from an unhandled signal). DIVERGES. */
static ll_value ll_invoke_restart(const char *name, ll_value packed_args) {
  /* Newest matching LL_RESTART frame wins (prev-ward walk). `which` = the offer index within that frame,
   * which the emitted restart-case pad switches on. ll_unwind runs intervening CLEANUP finallys en route. */
  for (ll_frame *f = ll_handler_top; f; f = f->prev) {
    if (f->kind != LL_RESTART) continue;
    for (size_t i = 0; i < f->name_count; i++) {
      if (strcmp(f->names[i], name) == 0) {
        ll_unwind(ll_handler_top, LL_UNWIND_RESTART, f, packed_args, (int)i); /* diverges */
      }
    }
  }
  ll_trap("ControlError", "invoke-restart: no restart with that name is in scope");
  return ll_nil(); /* unreachable */
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
  ll_closure *c = (ll_closure *)ll_gc_alloc(sizeof(ll_closure), LL_H_CLOSURE);
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

/* `(call f)` / `(call f [a b])` -- D1's escape hatch, made available to the native backend.
 *
 * D1 rules that `(x)` is a READ of `x`, not a zero-argument call, which leaves `call` as the ONLY way
 * to invoke a nullary function from source. That made it a language primitive rather than a host
 * convenience -- and it existed only in the JS shim, so every nullary API was unreachable on C
 * (`ELL0107: 'call' resolves to a JavaScript host global`).
 *
 * Variadic in the floor's sense -- (argc, argv), not C varargs. argv[0] is the callee; an optional
 * argv[1] is a VECTOR of arguments, matching the JS shim's `f(...args)` rather than spreading the
 * remaining slots. Anything else is a nil second argument, treated as "no arguments", so `(call f)`
 * and `(call f nil)` agree. */
static ll_value ll_call_dyn(int argc, ll_value *argv) {
  if (argc < 1) ll_trap("TypeError", "call: no function given");
  ll_value fn = argv[0];
  if (argc < 2 || argv[1].tag != LL_VEC) return ll_call(fn, 0, (ll_value *)0);
  ll_vec *a = argv[1].as.v;
  return ll_call(fn, (int)a->len, a->items);
}

/* A heap cell for a mutable-captured binding, shared between the origin frame and every closure that
 * captured it (spec A5 -- the shared mutable state the HIR does not express).
 *
 * A CELL IS A ONE-FIELD OBJECT, not a bare `ll_value*`, and that is what lets a GENERATOR capture a
 * mutable binding (C2). A generator's frame is `ll_obj.fields[]` -- a flexible array of `ll_value`,
 * uniformly boxed by construction -- so it can hold anything an `ll_value` can hold and nothing else.
 * A bare `ll_value*` is not one of those: the union is int/real/bool/char/str/vec/map/obj/closure and
 * has no pointer arm. Boxing the cell as an ordinary object makes it storable in a frame slot with no
 * change to the value union at all, which is the alternative this replaced -- an 11th tag would have
 * put a user-invisible arm through 47 `case LL_` sites, equality, copy and display, for something that
 * must never be observed.
 *
 * The allocation KIND stays `LL_H_CELL` rather than `LL_H_OBJ`: it is an accounting label (D59 -- the
 * collector is ruled and not built), and cells remain worth counting separately from user objects. */
/* `const char *` and NOT `const char *const`: `ll_class.field_names` is `const char **`, and the
 * emitter's own `static const char* __ll_fields_X[]` arrays match it. The inner `const` discarded a
 * qualifier at the initializer and put a warning on EVERY compiled program -- a build that always
 * warns is a build whose warnings nobody reads. */
static const char *LL_CELL_FIELD_NAMES[1] = {"v"};
static const ll_class LL_CELL_CLASS = {
  "__ll_cell", false, 1, LL_CELL_FIELD_NAMES, 0, 0, 0, 0, 0, false, 0
};

static ll_value ll_cell(ll_value initial) {
  ll_obj *c = (ll_obj *)ll_gc_alloc(sizeof(ll_obj) + sizeof(ll_value), LL_H_CELL);
  c->cls = &LL_CELL_CLASS;
  c->fields[0] = initial;
  return ll_box_obj(c);
}

/* Read / write THROUGH a cell. Every capture of a mutable binding goes through these, which is what
 * makes the binding shared rather than copied -- the defect C1 chased through three separate places. */
static ll_value ll_cell_get(ll_value cell) { return cell.as.o->fields[0]; }
static void ll_cell_set(ll_value cell, ll_value v) { cell.as.o->fields[0] = v; }

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

/* number->string (D51): the JS `Number.prototype.toString` result IS the spec, so this reproduces
   ECMA-262's Number::toString rather than deferring to printf.
   
   The DIGITS were already right -- try increasing precision until the value round-trips through
   strtod, which yields the shortest exact representation. What `%g` got wrong is everything around
   them: it picks fixed-vs-exponential from a precision-derived threshold and pads the exponent to two
   digits, so `0.000001` came out `1e-06` (wrong notation) and `1e-7` came out `1e-07` (wrong
   spelling). ECMA's rule is a plain threshold on the decimal exponent n: fixed while -6 < n <= 21,
   exponential outside, exponent written with a sign and no leading zeros. */
static void ll_fmt_double(char *buf, size_t cap, double d) {
  if (isnan(d)) { snprintf(buf, cap, "NaN"); return; }
  if (isinf(d)) { snprintf(buf, cap, d < 0 ? "-Infinity" : "Infinity"); return; }
  if (d == 0.0) { snprintf(buf, cap, signbit(d) ? "-0" : "0"); return; }

  /* Shortest round-tripping significant digits, as "d.dddde+XX". */
  char sci[64];
  for (int prec = 0; prec <= 17; prec++) {
    snprintf(sci, sizeof sci, "%.*e", prec, d);
    if (strtod(sci, NULL) == d) break;
  }

  /* Split into sign, digit string (point removed) and the decimal exponent. */
  const char *p = sci;
  int neg = (*p == '-');
  if (neg) p++;
  char digits[32];
  size_t k = 0;
  for (; *p && *p != 'e' && *p != 'E'; p++) {
    if (*p != '.' && k + 1 < sizeof digits) digits[k++] = *p;
  }
  while (k > 1 && digits[k - 1] == '0') k--;   /* ECMA: no trailing zeros in the digit string */
  digits[k] = '\0';
  int e10 = (*p == 'e' || *p == 'E') ? atoi(p + 1) : 0;
  int n = e10 + 1;                              /* value == 0.digits * 10^n */

  char out[64];
  size_t o = 0;
  if (neg) out[o++] = '-';
  if (n > 21 || n <= -6) {
    /* Exponential: one digit, optional fraction, then e(+|-)exp with no padding. */
    out[o++] = digits[0];
    if (k > 1) { out[o++] = '.'; for (size_t i = 1; i < k; i++) out[o++] = digits[i]; }
    o += (size_t)snprintf(out + o, sizeof out - o, "e%+d", n - 1);
  } else if (n >= (int)k) {
    /* Integral: all digits, then n-k zeros. Compared as INT: `n` is negative for a small value, and
       `(size_t)n >= k` made it a huge unsigned, so 0.000001 took this branch and wrote ~2^64 zeros. */
    for (size_t i = 0; i < k; i++) out[o++] = digits[i];
    for (int i = 0; i < n - (int)k; i++) out[o++] = '0';
  } else if (n > 0) {
    /* A point inside the digits. */
    for (size_t i = 0; i < k; i++) { if (i == (size_t)n) out[o++] = '.'; out[o++] = digits[i]; }
  } else {
    /* 0. then -n zeros then the digits. */
    out[o++] = '0'; out[o++] = '.';
    for (int i = 0; i < -n; i++) out[o++] = '0';
    for (size_t i = 0; i < k; i++) out[o++] = digits[i];
  }
  out[o] = '\0';
  snprintf(buf, cap, "%s", out);
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
  /* Each interpolation hole renders via DISPLAY (FLOOR.md 3.5) -- a String bare, everything else
     inspected -- matching the JS interp path (`__ll_display`). `ll_to_string_sb` was the JS `String()`
     rule instead: it prints `[object]` for an object, comma-joins a vector, and spells nil `null`, all
     of which diverge from JS's interpolation (field dump / `[ 1, 2 ]` / `nil` -- gap ledger §5.2 #4 and
     §12.3). It is also the arm where a Formattable value's `format` takes effect in interpolation, since
     `ll_display_str` -> `ll_inspect_at` is what dispatches it. `+` string concat keeps `ll_to_string_sb`
     (its own `ll_concat_vals`), matching JS `"" + x`. */
  for (int i = 0; i < n; i++) {
    ll_str *s = ll_display_str(vals[i]);
    ll_sb_put(&sb, s->data, s->len);
  }
  return ll_sb_finish(&sb);
}

/* -- inspect (node util.formatWithOptions parity -- what console.log and the goldens use) -------- */

static int64_t ll_utf8_next(const ll_str *s, size_t *i); /* defined with the codepoint floor below */
static size_t ll_cp_count(const char *data, size_t len); /* likewise -- the display layout needs it */

/* "Would the READER lex this as an identifier?" -- which is the only question §3.5 is actually
 * asking when it decides between `:key` and `"key"`, since D55 rules the display format to be
 * l-lang's own reader syntax. So it is not a judgement call: it is the tokenizer's `Identifier`
 * pattern, transcribed from frontend/grammar_v2/tokens.ts --
 *
 *     /[a-zA-Z_-￿][a-zA-Z0-9_\--￿]* /
 *
 * Both implementations had invented their own instead, and disagreed in BOTH directions: this one
 * allowed `$` and rejected `-`, the JS one the reverse, so `{"a-b" 1 :a$b 2}` here was `{:a-b 1
 * "a$b" 2}` there. Neither matched the reader -- `$` is not an identifier character in l-lang at all
 * (it lexes as an operator), `-` is the whole of D21's kebab-case, and NEITHER allowed the non-ASCII
 * the pattern has always permitted.
 *
 * The `>= 0x80` arm is that last clause. It deliberately admits astral codepoints too: the pattern is
 * matched by a JS regex without the `u` flag, so a surrogate PAIR is two code units both inside
 * `-￿`, and the reader accepts it. Answering differently here would be a divergence
 * invented to satisfy a range that JavaScript does not actually apply. */
static bool ll_ident_like(const ll_str *s) {
  if (s->len == 0) return false;
  size_t i = 0;
  bool first = true;
  while (i < s->len) {
    int64_t c = ll_utf8_next(s, &i);
    bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' || c >= 0x80 ||
              (!first && ((c >= '0' && c <= '9') || c == '-'));
    if (!ok) return false;
    first = false;
  }
  return true;
}

/* -- l-lang display (FLOOR.md 3.5, D55) ---------------------------------------------------------
   l-lang's OWN reader syntax, not node's: [1 2 3], {:a 1 :b 2}, "strings", nil, Point{:x 3},
   #<fn f>. A separate implementation of the same written rule the JS runtime implements; the two
   are kept in step by conformance guards, never by reading one off the other. */
#define LL_WIDTH 80

/* The cycle set GROWS. It was a fixed 256 slots whose push silently did nothing once full -- so a
   structure nested deeper than 256 stopped being tracked, a cycle below that line went undetected,
   and `ll_inspect_at` recursed until the process died. Measured: a 300-deep cycle SEGFAULTED (exit
   139) where JS rendered it. A silent cap on a correctness mechanism is not a cap, it is a crash
   with extra steps. */
typedef struct { const void **items; size_t len, cap; } ll_seen;

static void ll_seen_init(ll_seen *s) {
  s->len = 0;
  s->cap = 32;
  s->items = (const void **)ll_alloc(s->cap * sizeof(const void *));
}
static bool ll_seen_has(const ll_seen *s, const void *p) {
  for (size_t i = 0; i < s->len; i++) if (s->items[i] == p) return true;
  return false;
}
static void ll_seen_push(ll_seen *s, const void *p) {
  if (s->len == s->cap) {
    s->cap *= 2;
    s->items = (const void **)realloc(s->items, s->cap * sizeof(const void *));
    if (!s->items) ll_trap("OutOfMemory", "inspect cycle set grow failed");
  }
  s->items[s->len++] = p;
}
static void ll_seen_pop(ll_seen *s) { if (s->len) s->len--; }
static void ll_seen_free(ll_seen *s) { free(s->items); s->items = (const void **)0; }

/* l-lang string syntax: double quotes, and the escapes the reader would need to take it back. The
   old formatter emitted single quotes and escaped NOTHING, which read-back forbids. */
static void ll_sb_put_quoted(ll_sb *sb, const ll_str *s) {
  ll_sb_puts(sb, "\"");
  for (size_t i = 0; i < s->len; i++) {
    char c = s->data[i];
    switch (c) {
      case '\\': ll_sb_puts(sb, "\\\\"); break;
      case '"':  ll_sb_puts(sb, "\\\""); break;
      case '\n': ll_sb_puts(sb, "\\n"); break;
      case '\t': ll_sb_puts(sb, "\\t"); break;
      case '\r': ll_sb_puts(sb, "\\r"); break;
      default:   ll_sb_put(sb, &c, 1); break;
    }
  }
  ll_sb_puts(sb, "\"");
}

static void ll_inspect_at(ll_sb *sb, ll_value v, int indent, int prefix, ll_seen *seen, int flat);

static void ll_inspect_container(ll_sb *sb, ll_value v, int indent, int prefix, ll_seen *seen, int flat) {
  const char *tag = "";
  char open = '[', close = ']';
  size_t n = 0;
  ll_vec *vec = NULL; ll_map *map = NULL; ll_obj *obj = NULL;
  if (v.tag == LL_VEC) { vec = v.as.v; n = vec->len; }
  else if (v.tag == LL_MAP) { map = v.as.m; n = map->len; open = '{'; close = '}'; }
  else { obj = v.as.o; n = obj->cls->field_count; open = '{'; close = '}'; tag = obj->cls->name; }

  if (n == 0) { ll_sb_puts(sb, tag); char b[3] = { open, close, 0 }; ll_sb_puts(sb, b); return; }

  /* Render flat first, to measure it -- exactly what the rule says to do. THE TAG IS PART OF THE
     MEASUREMENT. It used to be written straight to `sb` above and left out of `one`, so a tagged
     instance was measured without its own name: `Wide{...}` whose braces span 78 columns stayed flat
     here at 82 columns wide, while JS -- which measures `tag + open + ... + close` -- broke it. */
  ll_sb one; ll_sb_init(&one);
  ll_sb_puts(&one, tag);
  ll_sb_put(&one, &open, 1);
  for (size_t i = 0; i < n; i++) {
    if (i) ll_sb_puts(&one, " ");
    if (map) {
      if (ll_ident_like(map->keys[i])) { ll_sb_puts(&one, ":"); ll_sb_put(&one, map->keys[i]->data, map->keys[i]->len); }
      else ll_sb_put_quoted(&one, map->keys[i]);
      ll_sb_puts(&one, " ");
      ll_inspect_at(&one, map->vals[i], 0, 0, seen, 1);
    } else if (obj) {
      ll_sb_puts(&one, ":"); ll_sb_puts(&one, obj->cls->field_names[i]); ll_sb_puts(&one, " ");
      ll_inspect_at(&one, obj->fields[i], 0, 0, seen, 1);
    } else {
      ll_inspect_at(&one, vec->items[i], 0, 0, seen, 1);
    }
  }
  ll_sb_put(&one, &close, 1);

  /* CHARACTERS, not bytes -- the budget is a column count (FLOOR.md 3.5). */
  if (flat || (size_t)(indent + prefix) + ll_cp_count(one.data, one.len) <= LL_WIDTH) {
    ll_sb_put(sb, one.data, one.len);
    free(one.data);
    return;
  }
  free(one.data);

  /* Broken: the newline IS the separator. The tag leads here too, matching `tag + open + "\n" ...`. */
  ll_sb_puts(sb, tag);
  ll_sb_put(sb, &open, 1);
  for (size_t i = 0; i < n; i++) {
    ll_sb_puts(sb, "\n");
    for (int p = 0; p < indent + 2; p++) ll_sb_puts(sb, " ");
    int head = 0;
    if (map) {
      if (ll_ident_like(map->keys[i])) {
        ll_sb_puts(sb, ":"); ll_sb_put(sb, map->keys[i]->data, map->keys[i]->len);
        head = 1 + (int)ll_cp_count(map->keys[i]->data, map->keys[i]->len);
      } else {
        ll_sb head_sb; ll_sb_init(&head_sb); ll_sb_put_quoted(&head_sb, map->keys[i]);
        ll_sb_put(sb, head_sb.data, head_sb.len);
        head = (int)ll_cp_count(head_sb.data, head_sb.len); free(head_sb.data);
      }
      ll_sb_puts(sb, " "); head += 1;
      ll_inspect_at(sb, map->vals[i], indent + 2, head, seen, 0);
    } else if (obj) {
      ll_sb_puts(sb, ":"); ll_sb_puts(sb, obj->cls->field_names[i]); ll_sb_puts(sb, " ");
      head = 2 + (int)ll_cp_count(obj->cls->field_names[i], strlen(obj->cls->field_names[i]));
      ll_inspect_at(sb, obj->fields[i], indent + 2, head, seen, 0);
    } else {
      ll_inspect_at(sb, vec->items[i], indent + 2, 0, seen, 0);
    }
  }
  ll_sb_puts(sb, "\n");
  for (int p = 0; p < indent; p++) ll_sb_puts(sb, " ");
  ll_sb_put(sb, &close, 1);
}

static void ll_inspect_at(ll_sb *sb, ll_value v, int indent, int prefix, ll_seen *seen, int flat) {
  char buf[64];
  switch (v.tag) {
    case LL_NIL: ll_sb_puts(sb, "nil"); return;              /* D9: the bottom value is spelled nil */
    case LL_INT: snprintf(buf, sizeof buf, "%" PRId64, v.as.i); ll_sb_puts(sb, buf); return;
    case LL_REAL: ll_fmt_double(buf, sizeof buf, v.as.d); ll_sb_puts(sb, buf); return;
    case LL_BOOL: ll_sb_puts(sb, v.as.b ? "true" : "false"); return;
    case LL_CHAR: {
      /* PROVISIONAL: the reader has no Char literal yet (FLOOR.md 3.5). */
      char c = (char)v.as.ch;
      ll_sb_puts(sb, "#\\"); ll_sb_put(sb, &c, 1);
      return;
    }
    case LL_STR: ll_sb_put_quoted(sb, v.as.s); return;
    case LL_CLOSURE: {
      const char *nm = v.as.fn->name;
      if (nm && nm[0]) { ll_sb_puts(sb, "#<fn "); ll_sb_puts(sb, nm); ll_sb_puts(sb, ">"); }
      else ll_sb_puts(sb, "#<fn>");
      return;
    }
    case LL_VEC: case LL_MAP: case LL_OBJ: {
      /* D58/G3: a generator renders as an unreadable-object marker carrying its SOURCE name, exactly
         parallel to `#<fn name>`. Never as `Name{...}`: a generator's members ARE the suspended frame
         -- a state number plus whatever locals live across the yield -- so the container form would
         put a program counter and compiler-generated storage into user-facing output. FLOOR.md 3.5. */
      if (v.tag == LL_OBJ && v.as.o->cls->is_gen) {
        const char *gn = v.as.o->cls->name;
        if (gn && gn[0]) { ll_sb_puts(sb, "#<generator "); ll_sb_puts(sb, gn); ll_sb_puts(sb, ">"); }
        else ll_sb_puts(sb, "#<generator>");
        return;
      }
      /* Formattable (std/core/protocols): a value that :implements it renders through its own `format`
         rather than the default `Name{...}` dump -- everywhere the display path reaches. NOMINAL
         (ll_is_type walks the :implements closure), mirroring the JS inspectJs arm, so the two backends
         render an opted-in type identically and leave every other type untouched. */
      if (v.tag == LL_OBJ && ll_is_type(v, "Formattable", 0)) {
        ll_value fs = ll_dyn_method(2, (ll_value[]){v, ll_box_str(ll_str_lit("format"))});
        if (fs.tag == LL_STR) { ll_sb_put(sb, fs.as.s->data, fs.as.s->len); return; }
      }
      const void *p = v.tag == LL_VEC ? (const void *)v.as.v
                    : v.tag == LL_MAP ? (const void *)v.as.m : (const void *)v.as.o;
      if (ll_seen_has(seen, p)) { ll_sb_puts(sb, "#<circular>"); return; }
      ll_seen_push(seen, p);
      ll_inspect_container(sb, v, indent, prefix, seen, flat);
      ll_seen_pop(seen);
      return;
    }
    default: ll_sb_puts(sb, "#<object>"); return;
  }
}

static void ll_inspect_sb(ll_sb *sb, ll_value v) {
  ll_seen seen;
  ll_seen_init(&seen);
  ll_inspect_at(sb, v, 0, 0, &seen, 0);
  ll_seen_free(&seen);
}

/* display(v) as a STRING (FLOOR.md 3.5): a String at top level is itself, anything else is inspected.
   Same rule ll_console_write applies per argument -- exposed so l-lang above the floor can call it. */
static ll_str *ll_display_str(ll_value v) {
  if (v.tag == LL_STR) return v.as.s;
  /* Through `ll_inspect_sb`, which owns the cycle set's lifetime -- this used to open-code
     `ll_seen seen; seen.len = 0;` and call `ll_inspect_at` directly. That was fine while `ll_seen`
     was a fixed array and `len = 0` was the whole of its initialization; the moment it grew a heap
     pointer, the duplicate left `items` wild and `(display [[1] [2]])` segfaulted at nesting depth
     TWO. One construction site, so there is nothing to keep in step. */
  ll_sb sb; ll_sb_init(&sb);
  ll_inspect_sb(&sb, v);
  ll_str *out = ll_str_from(sb.data, sb.len);
  free(sb.data);
  return out;
}

/* THE i/o sink (Fb, FLOOR.md 2): raw bytes to the stream. No newline, no formatting, no join --
   everything above it is a layer, on this backend exactly as on the other. */
static void ll_write_string(ll_str *s) { fwrite(s->data, 1, s->len, stdout); }
static void ll_write_string_err(ll_str *s) { fwrite(s->data, 1, s->len, stderr); }

/* ---------------------------------------------------------------------------------------------
 * The PROCESS floor: argv, the environment, the exit status.
 *
 * `main` is emitted as `int main(int argc, char** argv)` and stores both here before anything else
 * runs. It has to be captured rather than reached for, because C gives a program its arguments in
 * exactly one place -- main's parameters -- and every other function in the translation unit is
 * downstream of that. JS has `process.argv` as a global and needs no such handoff, which is why this
 * pair of statics has no counterpart over there.
 *
 * The `argv + 1` offset is a CONFORMANCE decision, not a convenience: node's `process.argv` leads
 * with the interpreter and the script path (dropped with `.slice(2)`), and C's `argv[0]` is the
 * program name. Both are "how this process was invoked" rather than "what the user asked for", so
 * both are dropped and `args` means the same thing on both backends. Disagree here and every index
 * into `args` is off by one on one of them.
 * --------------------------------------------------------------------------------------------- */
static int    ll_argc = 0;
static char **ll_argv = 0;

/* Argument `i`, or nil past the end. `argv + 1` is the CONFORMANCE decision, not a convenience: node's
 * `process.argv` leads with the interpreter and the script path, C's `argv[0]` is the program name.
 * Both answer "how was this process invoked" rather than "what was asked for", so both are dropped
 * and index 0 means the same argument on either backend. Disagree here and every index is off by one
 * on exactly one of them. */
static ll_value ll_sys_arg(int64_t i) {
  if (i < 0 || i + 1 >= (int64_t)ll_argc) return ll_nil();
  return ll_box_str(ll_str_lit(ll_argv[i + 1]));
}

/* nil for UNSET, not "" -- absent and empty are different questions and D9 has one bottom value to
 * say the first with. `getenv` answers NULL for unset and a valid empty string for `FOO=`, so the
 * distinction survives here exactly as it does through JS's `undefined` check. */
static ll_value ll_sys_env(ll_str *name) {
  const char *v = getenv(name->data);
  return v ? ll_box_str(ll_str_lit(v)) : ll_nil();
}

static void ll_sys_exit(int64_t code) { exit((int)code); }

/* ---------------------------------------------------------------------------------------------
 * The TIME floor. Two clocks, never one name -- MONOTONIC for durations, WALL for timestamps.
 * Conflating them is the classic silent bug: a wall clock steps backwards under NTP, so a duration
 * measured with it can come out negative. `mono-ns` has an arbitrary epoch and is only ever
 * subtracted; `wall-ms` is Unix-epoch and is only ever displayed.
 *
 * Nanoseconds as int64 is not a precision flourish, it is what both hosts already hand back:
 * clock_gettime here, `process.hrtime.bigint()` there, and D51 makes an Int an int64 on both. ~292
 * years of range, so wall time overflows in 2262. `sleep-ns` is a MINIMUM, never an exact interval
 * -- the OS decides when it is done, and both hosts overshoot.
 * --------------------------------------------------------------------------------------------- */

/* One entry, a selector, because a NULLARY floor entry cannot be called from source -- D1 makes
   `(mono-ns)` a read of the binding. See floor.ts; it was measured end-to-end before being ruled. */
static int64_t ll_clock_ns(ll_str *which) {
  struct timespec ts;
  const char *w = which ? which->data : "";
  if (strcmp(w, "mono") == 0) {
    clock_gettime(CLOCK_MONOTONIC, &ts);
  } else if (strcmp(w, "wall") == 0) {
    clock_gettime(CLOCK_REALTIME, &ts);
  } else {
    ll_trap("ValueError", "clock-ns: expected \"mono\" or \"wall\"");
  }
  return (int64_t)ts.tv_sec * 1000000000LL + (int64_t)ts.tv_nsec;
}

/* Retried on EINTR: a signal must not turn a 16ms sleep into a 0ms one, which would silently
   busy-spin a fixed-step loop instead of pacing it. */
static void ll_sleep_ns(int64_t ns) {
  if (ns <= 0) return;
  struct timespec req;
  req.tv_sec = (time_t)(ns / 1000000000LL);
  req.tv_nsec = (long)(ns % 1000000000LL);
  struct timespec rem;
  while (nanosleep(&req, &rem) != 0) req = rem;
}

/* ---------------------------------------------------------------------------------------------
 * The FILE floor. The handle is an INT file descriptor -- what both hosts already use.
 *
 * TOTAL, deliberately: -1 for a failed open, nil at EOF, -1 for a failed write. The THROWING half of
 * the API is l-lang, in `std/io/files`. Building it the other way round would need exceptions to
 * cross the floor boundary identically on both backends, which is a far larger promise than nil.
 * --------------------------------------------------------------------------------------------- */

/* How many more bytes are needed to complete the UTF-8 sequence this buffer ends in? 0 if it already
 * ends on a boundary. Bounded by 3 -- the longest scalar-value encoding is four bytes.
 *
 * This is what keeps a CHUNKED read from splitting a codepoint. Without it `read-file` on a
 * non-ASCII file would silently produce U+FFFD at every chunk boundary, violating D52 in the reader
 * itself and only for input the corpus never exercises. */
static int ll_utf8_want(const unsigned char *b, size_t n) {
  size_t i = n;
  int back = 0;
  while (i > 0 && back < 4) {
    unsigned char c = b[i - 1];
    back++;
    if ((c & 0xC0) != 0x80) { /* a lead byte (or ASCII) */
      int len = (c < 0x80) ? 1 : (c & 0xE0) == 0xC0 ? 2 : (c & 0xF0) == 0xE0 ? 3 : (c & 0xF8) == 0xF0 ? 4 : 1;
      return len > back ? len - back : 0;
    }
    i--;
  }
  return 0;
}

static int64_t ll_file_open(ll_str *path, ll_str *mode) {
  int flags;
  const char *m = mode->data;
  if (strcmp(m, "r") == 0) flags = O_RDONLY;
  else if (strcmp(m, "w") == 0) flags = O_WRONLY | O_CREAT | O_TRUNC;
  else if (strcmp(m, "a") == 0) flags = O_WRONLY | O_CREAT | O_APPEND;
  else return -1;
  int fd = open(path->data, flags, 0644);
  return (int64_t)fd;
}

static void ll_file_close(int64_t fd) {
  if (fd >= 0) close((int)fd);
}

static ll_value ll_file_read(int64_t fd, int64_t n) {
  if (fd < 0 || n <= 0) return ll_nil();
  size_t cap = (size_t)n + 4; /* room for the boundary completion */
  unsigned char *buf = (unsigned char *)ll_alloc(cap);
  ssize_t got = read((int)fd, buf, (size_t)n);
  if (got <= 0) return ll_nil(); /* EOF or error -- nil MEANS done */
  size_t len = (size_t)got;
  int want = ll_utf8_want(buf, len);
  while (want > 0 && len < cap) {
    ssize_t more = read((int)fd, buf + len, (size_t)want);
    if (more <= 0) break;
    len += (size_t)more;
    want = ll_utf8_want(buf, len);
  }
  return ll_box_str(ll_str_from((const char *)buf, len));
}

static int64_t ll_file_write(int64_t fd, ll_str *s) {
  if (fd < 0) return -1;
  ssize_t put = write((int)fd, s->data, s->len);
  return (int64_t)put;
}

static bool ll_file_exists(ll_str *path) {
  struct stat st;
  return stat(path->data, &st) == 0;
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
  ll_sb_puts(&sb, "\n");
  /* through the sink, not straight to the stream: one primitive, one place bytes leave. */
  if (out == stderr) { ll_str tmp; tmp.data = sb.data; tmp.len = sb.len; ll_write_string_err(&tmp); }
  else { ll_str tmp; tmp.data = sb.data; tmp.len = sb.len; ll_write_string(&tmp); }
  free(sb.data);
}

static void ll_console_log(int n, ll_value *vals) { ll_console_write(stdout, n, vals); }
static void ll_console_error(int n, ll_value *vals) { ll_console_write(stderr, n, vals); }

/* -- equality (D9: one nil; JS number semantics across Int/Real) --------------------------------- */

/* THE SAME OBJECT, not merely an equal one. The JS shim opens `__ll_deep_eq` with `if (a === b)
   return true;` and this had no counterpart, so a structure that reaches itself recursed forever:
   `(== a a)` on a self-referential object was a SIGSEGV on C where the oracle answered `true`.
   Identity implying equality decides nothing that was not already decided -- it is the one case where
   the recursive walk is provably redundant. */
static bool ll_same_ref(ll_value a, ll_value b) {
  if (a.tag != b.tag) return false;
  switch (a.tag) {
    case LL_STR: return a.as.s == b.as.s;
    case LL_VEC: return a.as.v == b.as.v;
    case LL_MAP: return a.as.m == b.as.m;
    case LL_OBJ: return a.as.o == b.as.o;
    case LL_CLOSURE: return a.as.fn == b.as.fn;
    default: return false;
  }
}

/* How deep the walk may go before it gives up. Identity closes the self-comparison case above, but
   TWO DISTINCT structures that each reach themselves still have no finite walk -- and whether they
   are EQUAL is an open question (co-inductive equality would say yes; nothing here has ruled it).
   So this refuses rather than answering: a bounded, catchable, located failure in place of a stack
   overflow, and no claim either way about the pair. The oracle blows its own call stack on the same
   program, so it is not deciding this either.

   10000 is far past any structure a program builds by nesting -- the recursion is per LEVEL, not per
   element, so a million-element vector is depth 1 -- and far short of the C stack this frame would
   need to exhaust it. */
#define LL_EQ_MAX_DEPTH 10000

static bool ll_deep_eq_at(ll_value a, ll_value b, int depth);

static bool ll_deep_eq(ll_value a, ll_value b) { return ll_deep_eq_at(a, b, 0); }

static bool ll_deep_eq_at(ll_value a, ll_value b, int depth) {
  if (ll_same_ref(a, b)) return true;
  /* RangeError and not ValueError, for TWO reasons and only one of them is taste. D82 makes a trap
     catchable by finding a CLASS of the kind's name in the emitted module, and `ValueError` is not in
     the ambient tower -- so the first spelling of this stayed fatal, escaping a `catch e :of Error`
     that caught it perfectly on JS. `RangeError` is ambient, and it is also what the oracle's own
     host raises when the same program exhausts its call stack, so the two backends now fail the same
     way as well as reporting the same shape. */
  if (depth > LL_EQ_MAX_DEPTH)
    ll_trap("RangeError", "deep equality exceeded the maximum structure depth -- the values may be cyclic");
  if (a.tag == LL_NIL || b.tag == LL_NIL) return a.tag == LL_NIL && b.tag == LL_NIL;
  /* Int vs Int compares as int64. Widening BOTH to double -- which this did -- collapses every pair
     that differs above 2^53 onto the same value, so `9007199254740993 == 9007199254740992` was true.
     D51 made that reachable by giving Int a full 64-bit range, and Fe's guards only pinned how an Int
     PRINTS, so the comparison path kept the bug. A Real operand still promotes, per D51's mixed rule. */
  if (a.tag == LL_INT && b.tag == LL_INT) return a.as.i == b.as.i;
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
        if (!ll_deep_eq_at(a.as.v->items[i], b.as.v->items[i], depth + 1)) return false;
      }
      return true;
    }
    case LL_MAP: {
      if (a.as.m->len != b.as.m->len) return false;
      for (size_t i = 0; i < a.as.m->len; i++) {
        bool found = false;
        for (size_t j = 0; j < b.as.m->len; j++) {
          if (ll_str_eq(a.as.m->keys[i], b.as.m->keys[j])) {
            if (!ll_deep_eq_at(a.as.m->vals[i], b.as.m->vals[j], depth + 1)) return false;
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
        if (!ll_deep_eq_at(a.as.o->fields[i], b.as.o->fields[i], depth + 1)) return false;
      }
      return true;
    }
    default: return false;
  }
}

/* Strict (===) equality for indexOf/includes: content for primitives, identity for containers. */
static bool ll_strict_eq(ll_value a, ll_value b) {
  /* Same int64 exactness as ll_deep_eq -- this is the path indexOf/includes take, so without it a
     container search "finds" a value that is not in it. */
  if (a.tag == LL_INT && b.tag == LL_INT) return a.as.i == b.as.i;
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
  ll_obj *dst = (ll_obj *)ll_gc_alloc(sizeof(ll_obj) + src->cls->field_count * sizeof(ll_value), LL_H_OBJ);
  dst->cls = src->cls;
  for (size_t i = 0; i < src->cls->field_count; i++) dst->fields[i] = ll_copy(src->fields[i]);
  return ll_box_obj(dst);
}

/* `deep-copy` -- the EXPLICIT deep copy, and NOT the same operation as `ll_copy` above.
 *
 * `ll_copy` is D11's STORE copy: memberwise on a struct, and a reference field is SHARED, which is
 * the C# rule the language chose. `deep-copy` is the one a program asks for by name, and it recurses
 * through arrays as well -- so a vector of structs comes back with copied elements.
 *
 * The two had to be told apart the moment `deep-copy` went on the floor. JS has both (`__ll_copy` and
 * `deep2dcopy`); C had only the first, so mapping the floor entry at `ll_copy` would have made
 * `(deep-copy [s1 s2])` share its elements here and copy them there -- a silent divergence
 * introduced by the very act of modelling the name.
 *
 * A MAP is returned as-is, matching the JS shim: it recurses into arrays and structs and nothing
 * else. Not obviously right, but it is what the language already does, and changing it is a ruling
 * rather than a port. */
static ll_value ll_deep_copy(ll_value v) {
  if (v.tag == LL_VEC) {
    ll_vec *src = v.as.v;
    ll_vec *dst = ll_vec_new(src->len ? src->len : 4);
    for (size_t i = 0; i < src->len; i++) dst->items[i] = ll_deep_copy(src->items[i]);
    dst->len = src->len;
    return ll_box_vec(dst);
  }
  if (v.tag == LL_OBJ && v.as.o->cls->is_struct) {
    const ll_obj *src = v.as.o;
    ll_obj *dst = (ll_obj *)ll_gc_alloc(sizeof(ll_obj) + src->cls->field_count * sizeof(ll_value), LL_H_OBJ);
    dst->cls = src->cls;
    for (size_t i = 0; i < src->cls->field_count; i++) dst->fields[i] = ll_deep_copy(src->fields[i]);
    return ll_box_obj(dst);
  }
  return v;
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
    m->keys = (ll_str **)ll_gc_realloc(m->keys, m->cap * sizeof(ll_str *));
    m->vals = (ll_value *)ll_gc_realloc(m->vals, m->cap * sizeof(ll_value));
    if (!m->keys || !m->vals) ll_trap("OutOfMemory", "map grow failed");
  }
  m->keys[m->len] = ks;
  m->vals[m->len] = ll_nil();
  return &m->vals[m->len++];
}

/* -- indexing: partial (trap) vs total (nil) ----------------------------------------------------- */

static ll_value ll_index_vec(ll_vec *v, int64_t i) {
  /* The message NAMES THE INDEX AND THE LENGTH, matching the JS shim's `IndexOutOfRange: 99 (length 3)`
   * verbatim. Now that a RangeError is catchable, `(e.message)` is something a program READS -- so the
   * two backends producing different text would be a divergence a golden could not paper over, and
   * "vector index out of bounds" told the reader nothing they could act on. */
  if (i < 0 || (size_t)i >= v->len) ll_trap_index(i, v->len);
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

/* -- the map floor (D53) -----------------------------------------------------------------------
   Insertion-ordered with String keys. `ll_map` is an association list appended at `len`, so the
   order is structural rather than maintained -- which is why C needs no bookkeeping here and JS
   does (a plain Object reorders integer-like keys). Keys arrive BOXED and are stringified by
   `ll_to_str`, matching `ll_map_slot`: D53's "String keys" describes the key SPACE, not the
   argument type, and `(m[1] := v)` has always written the key "1". */
static ll_map *ll_map_new0(void) { return ll_map_new(4); }

static ll_value ll_map_get_v(ll_map *m, ll_value key) {
  return ll_get_map(m, ll_to_str(key));
}

static ll_value ll_map_set_v(ll_map *m, ll_value key, ll_value val) {
  *ll_map_slot(m, key) = val;
  return ll_nil();
}

static bool ll_map_has(ll_map *m, ll_value key) {
  ll_str *k = ll_to_str(key);
  for (size_t i = 0; i < m->len; i++) if (ll_str_eq(m->keys[i], k)) return true;
  return false;
}

/* Removing shifts the tail down, which is what keeps insertion order a property of the array rather
   than something separately tracked. O(n), like every other operation on an assoc list. */
static bool ll_map_delete(ll_map *m, ll_value key) {
  ll_str *k = ll_to_str(key);
  for (size_t i = 0; i < m->len; i++) {
    if (!ll_str_eq(m->keys[i], k)) continue;
    for (size_t j = i + 1; j < m->len; j++) { m->keys[j - 1] = m->keys[j]; m->vals[j - 1] = m->vals[j]; }
    m->len--;
    return true;
  }
  return false;
}

static ll_vec *ll_map_keys(ll_map *m) {
  ll_vec *out = ll_vec_new(m->len ? m->len : 4);
  for (size_t i = 0; i < m->len; i++) out->items[i] = ll_box_str(m->keys[i]);
  out->len = m->len;
  return out;
}


/* The codepoint decoder, declared here and defined with the rest of the string surface below (the
 * same forward-declaration pattern `ll_is_type` uses). Everything from here down that takes or
 * returns a string POSITION or WIDTH counts codepoints, per D52 -- byte offsets do not leave
 * runtime.c. */
static int64_t ll_cp_length(ll_str *s);
static size_t ll_cp_offset(const ll_str *s, int64_t k);
static size_t ll_cp_next_offset(const ll_str *s, size_t at);

/* `s[i]` is PARTIAL (D9): an out-of-range index is a bug, not a value, so it traps rather than
   answering "". The total form is `(get s i)` below. Both index CHARACTERS now -- indexing bytes
   handed back half of a multi-byte character, which is not a value the language has. */
static ll_str *ll_index_str(ll_str *s, int64_t i) {
  if (i < 0) ll_trap("RangeError", "string index out of bounds");
  size_t a = ll_cp_offset(s, i);
  if (a >= s->len) ll_trap("RangeError", "string index out of bounds");
  return ll_str_from(s->data + a, ll_cp_next_offset(s, a) - a);
}

static ll_value ll_index_dyn(ll_value base, ll_value idx) {
  switch (base.tag) {
    case LL_VEC: return ll_index_vec(base.as.v, ll_unbox_int(idx));
    case LL_MAP: return ll_index_map(base.as.m, ll_to_str(idx));
    case LL_STR: return ll_box_str(ll_index_str(base.as.s, ll_unbox_int(idx)));
    default: ll_trap("TypeError", "value is not indexable"); return ll_nil();
  }
}

/* Lvalue for an index STORE on a BOXED container: `(world.boxes[i] := v)`, where the base came back
 * from a dynamic member read and its static type is only `ll_value`. The write-side analog of
 * ll_index_dyn, returning a slot pointer the way ll_map_slot / ll_member_slot do. A string index
 * store has no slot to hand out (ll_str is immutable here), so it traps rather than lying. */
static ll_value *ll_index_slot(ll_value base, ll_value idx) {
  switch (base.tag) {
    case LL_VEC: {
      int64_t i = ll_unbox_int(idx);
      if (i < 0 || (size_t)i >= base.as.v->len) ll_trap_index(i, base.as.v->len);
      return &base.as.v->items[i];
    }
    case LL_MAP: return ll_map_slot(base.as.m, idx);
    default: ll_trap("TypeError", "value is not index-assignable"); return (ll_value *)0;
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
    /* Int or String only. A map's key SPACE is String and both runtimes stringify on the way in
       (D53), so `(m[1] := v)` and `(get m 1)` agree -- but a Real, a Boolean or a container is not a
       key at all, and stringifying one would invent a key the program never wrote. */
    case LL_MAP:
      if (k.tag != LL_INT && k.tag != LL_STR) return ll_nil();
      return ll_get_map(c.as.m, ll_to_str(k));
    case LL_STR: {
      if (k.tag != LL_INT) return ll_nil();
      int64_t i = k.as.i;
      if (i < 0) return ll_nil();
      size_t a = ll_cp_offset(c.as.s, i);
      if (a >= c.as.s->len) return ll_nil();
      return ll_box_str(ll_str_from(c.as.s->data + a, ll_cp_next_offset(c.as.s, a) - a));
    }
    default: return ll_nil();
  }
}

static ll_value ll_elem(ll_value c, ll_value k) { return ll_get(c, k); }

/* TOTAL, like `ll_get`/`ll_elem`/`ll_empty` beside them (D9). These called `ll_unbox_vec`
   UNGUARDED, so `(head "abc")` -- or, far more realistically, `(head (get m "missing"))`, since
   `get` is total and answers nil on a miss -- TRAPPED and killed the process, printing nothing,
   where JS answered nil. Every sibling in this cluster is a switch with a nil/default arm; these two
   were the exception. A wrong answer is recoverable; a process death mid-`console.log` is not. */
static ll_value ll_head(ll_value c) {
  if (c.tag != LL_VEC) return ll_nil();
  ll_vec *v = c.as.v;
  return v->len ? v->items[0] : ll_nil();
}

/* An EMPTY vector for a non-vector, not the argument: the floor declares `tail : Any -> Array`, and
   handing back a String would make that declaration false (the JS half did exactly that). */
static ll_vec *ll_tail(ll_value c) {
  if (c.tag != LL_VEC) return ll_vec_new(4);
  ll_vec *v = c.as.v;
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

/* `.length` on a String answers in CHARACTERS (D52), not bytes. This used to be `s->len` -- so
   `"café".length` was 5 here and 4 on JS, and `"Привіт".length` was 12 and 6. */
static int64_t ll_str_len(ll_str *s);

/* -- the CODEPOINT floor (D52) -------------------------------------------------------------------
 *
 * D52 rules a String a sequence of Unicode SCALAR VALUES -- not UTF-16 code units (JavaScript's
 * accident) and not bytes (this backend's). Both backends were wrong, in different directions, and
 * `(strlen "a<emoji>b")` measured it: 6 here (bytes) and 4 on JS (surrogate halves) where the answer
 * is 3. So this is not "make C match JS"; it is a floor both of them are built onto.
 *
 * An Int, not a Char. `codepoint-at` answers with the scalar value itself, which sidesteps LL_CHAR
 * entirely -- a Char has no agreed rendering (the display formatter still has no JS arm for one) and
 * an Int is already distinguishable from a Real on both backends after D51. One less representation
 * to converge.
 *
 * `-1` for out of range, not nil. A codepoint is non-negative by definition, so -1 is out of band
 * rather than an in-band lie -- the objection D9 raises to a sentinel does not apply. It also lets
 * l-lang above the floor do bounds-free lookahead, which is exactly what `io.lisp`'s format scanner
 * already relies on `charAt` returning "" for.
 */

/* Decode one UTF-8 sequence at byte offset *i and advance *i past it. A malformed, truncated or
   overlong-lead sequence yields U+FFFD and advances exactly ONE byte -- so decoding always makes
   progress and a corrupt string can neither hang a caller nor read past the end. */
static int64_t ll_utf8_next(const ll_str *s, size_t *i) {
  const unsigned char *p = (const unsigned char *)s->data;
  size_t k = *i;
  unsigned char c = p[k];
  if (c < 0x80) { *i = k + 1; return (int64_t)c; }
  int extra;
  int64_t cp;
  if ((c & 0xE0) == 0xC0) { extra = 1; cp = c & 0x1F; }
  else if ((c & 0xF0) == 0xE0) { extra = 2; cp = c & 0x0F; }
  else if ((c & 0xF8) == 0xF0) { extra = 3; cp = c & 0x07; }
  else { *i = k + 1; return 0xFFFD; }
  if (k + (size_t)extra >= s->len) { *i = k + 1; return 0xFFFD; }
  for (int j = 1; j <= extra; j++) {
    unsigned char cc = p[k + j];
    if ((cc & 0xC0) != 0x80) { *i = k + 1; return 0xFFFD; }
    cp = (cp << 6) | (cc & 0x3F);
  }
  *i = k + (size_t)extra + 1;
  return cp;
}

static int64_t ll_cp_length(ll_str *s) {
  size_t i = 0;
  int64_t n = 0;
  while (i < s->len) { ll_utf8_next(s, &i); n++; }
  return n;
}

/* `.length` on a String, and the whole reason it moved: characters, not bytes. */
static int64_t ll_str_len(ll_str *s) { return ll_cp_length(s); }

/* Codepoint count of a raw UTF-8 buffer. A continuation byte is 10xxxxxx; everything else starts a
   character, so this needs no decoding. The display layout (FLOOR.md 3.5) measures its 80-column
   budget in CHARACTERS, and measured it in BYTES until this existed -- a Cyrillic map broke across
   four lines at 54 columns because its 41-character value counted as 74. */
static size_t ll_cp_count(const char *data, size_t len) {
  size_t n = 0;
  for (size_t i = 0; i < len; i++) if (((unsigned char)data[i] & 0xC0) != 0x80) n++;
  return n;
}

/* Byte offset of codepoint index k. Clamps to s->len, so `k == cp_length` yields the end and any k
   past that yields the end too -- which is what makes the slice/pad clamping below total. */
static size_t ll_cp_offset(const ll_str *s, int64_t k) {
  size_t i = 0;
  int64_t n = 0;
  while (i < s->len && n < k) { ll_utf8_next(s, &i); n++; }
  return i;
}

/* Byte offset just past the character starting at `at`. */
static size_t ll_cp_next_offset(const ll_str *s, size_t at) {
  size_t i = at;
  if (i < s->len) ll_utf8_next(s, &i);
  return i;
}

/* Codepoint index of a BYTE offset -- the conversion `index-of` needs, since the search itself runs
   on bytes (and may: UTF-8 is self-synchronizing, so a valid needle cannot match mid-character). */
static int64_t ll_cp_index_of_offset(const ll_str *s, size_t at) {
  size_t i = 0;
  int64_t n = 0;
  while (i < at && i < s->len) { ll_utf8_next(s, &i); n++; }
  return n;
}

static int64_t ll_cp_at(ll_str *s, int64_t idx) {
  if (idx < 0) return -1;
  size_t i = 0;
  int64_t k = 0;
  while (i < s->len) {
    int64_t cp = ll_utf8_next(s, &i);
    if (k == idx) return cp;
    k++;
  }
  return -1;
}

/* `charCodeAt` -- declared to the checker, implemented nowhere on C until now.
 *
 * D52 says a String is a sequence of CODEPOINTS, so this answers the codepoint at index `idx`, which
 * is `ll_cp_at`. That deliberately DIVERGES from JS below the astral plane boundary, where
 * `charCodeAt` returns a UTF-16 code UNIT and would give a surrogate half. It is the same call D50's
 * native-member amendment records for `.length`: the host owns what the operation MEANS, and on C
 * there is no host -- `ll_dyn_method` is our code imitating a surface that does not exist below it --
 * so C picks the answer that agrees with the language's own ruling rather than with UTF-16. Pinned as
 * a documented divergence alongside `native_string_astral.lisp`. */
static int64_t ll_str_char_code_at(ll_str *s, int64_t idx) { return ll_cp_at(s, idx); }

/* Encode one scalar value as UTF-8. A value outside U+0000..U+10FFFF, or a surrogate (U+D800..DFFF,
   which is not a scalar value and has no UTF-8 encoding), is written as U+FFFD -- the same answer
   `ll_utf8_next` gives for input it cannot read, so a round trip through either direction is total. */
static void ll_sb_put_cp(ll_sb *sb, int64_t cp) {
  char buf[4];
  if (cp < 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) cp = 0xFFFD;
  if (cp < 0x80) {
    buf[0] = (char)cp;
    ll_sb_put(sb, buf, 1);
  } else if (cp < 0x800) {
    buf[0] = (char)(0xC0 | (cp >> 6));
    buf[1] = (char)(0x80 | (cp & 0x3F));
    ll_sb_put(sb, buf, 2);
  } else if (cp < 0x10000) {
    buf[0] = (char)(0xE0 | (cp >> 12));
    buf[1] = (char)(0x80 | ((cp >> 6) & 0x3F));
    buf[2] = (char)(0x80 | (cp & 0x3F));
    ll_sb_put(sb, buf, 3);
  } else {
    buf[0] = (char)(0xF0 | (cp >> 18));
    buf[1] = (char)(0x80 | ((cp >> 12) & 0x3F));
    buf[2] = (char)(0x80 | ((cp >> 6) & 0x3F));
    buf[3] = (char)(0x80 | (cp & 0x3F));
    ll_sb_put(sb, buf, 4);
  }
}

/* The inverse, and the reason `std/string` is linear rather than quadratic. Every operation up there
   decodes ONCE into an Int[], works on it with ordinary vector code, and encodes once. Built out of
   `codepoint-at` instead, each of those loops would re-walk the string per character. */
static ll_vec *ll_string_to_codepoints(ll_str *s) {
  size_t i = 0;
  /* `ll_vec_grow` and not `ll_vec_push`: push is defined further down the file with the rest of the
     vector method surface, and the string ops sit above it. Same ordering constraint the map floor
     hit -- an implicit declaration here is an error under C99, not a warning. */
  ll_vec *out = ll_vec_new(s->len ? s->len : 4);
  while (i < s->len) {
    ll_vec_grow(out, out->len + 1);
    out->items[out->len++] = ll_box_int(ll_utf8_next(s, &i));
  }
  return out;
}

static ll_str *ll_string_from_codepoints(ll_vec *cps) {
  ll_sb sb;
  ll_sb_init(&sb);
  for (size_t i = 0; i < cps->len; i++) ll_sb_put_cp(&sb, ll_unbox_int(cps->items[i]));
  return ll_sb_finish(&sb);
}

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

static ll_str *ll_str_trim_end(ll_str *s) {
  size_t b = s->len;
  while (b > 0 && (s->data[b - 1] == ' ' || s->data[b - 1] == '\t' || s->data[b - 1] == '\n' || s->data[b - 1] == '\r')) b--;
  return ll_str_from(s->data, b);
}

/* The missing third of the trim family. `trim` and `trimEnd` existed; `trimStart` was DECLARED to the
 * checker and implemented nowhere, so C refused it (ELL0106) while JS answered. ASCII whitespace
 * only, per D52/Ff-2 -- the same four characters the other two use, deliberately not JS's ~25. */
static ll_str *ll_str_trim_start(ll_str *s) {
  size_t a = 0;
  while (a < s->len && (s->data[a] == ' ' || s->data[a] == '\t' || s->data[a] == '\n' || s->data[a] == '\r')) a++;
  return ll_str_from(s->data + a, s->len - a);
}

static int64_t ll_slice_clamp(int64_t i, size_t len) {
  if (i == LL_END) return (int64_t)len;
  if (i < 0) i += (int64_t)len;
  if (i < 0) i = 0;
  if (i > (int64_t)len) i = (int64_t)len;
  return i;
}

/* Codepoint indices in, and the SAME negative/clamping rules as before -- `ll_slice_clamp` just
   works against the character count instead of the byte count now. */
static ll_str *ll_str_slice(ll_str *s, int64_t start, int64_t end) {
  size_t n = (size_t)ll_cp_length(s);
  int64_t a = ll_slice_clamp(start, n);
  int64_t b = ll_slice_clamp(end, n);
  if (b < a) b = a;
  size_t ba = ll_cp_offset(s, a);
  size_t bb = ll_cp_offset(s, b);
  return ll_str_from(s->data + ba, bb - ba);
}

static int64_t ll_str_find(ll_str *s, ll_str *needle, int64_t from) {
  if (needle->len > s->len) return -1;
  for (size_t i = (size_t)(from < 0 ? 0 : from); i + needle->len <= s->len; i++) {
    if (memcmp(s->data + i, needle->data, needle->len) == 0) return (int64_t)i;
  }
  return -1;
}

/* The SEARCH runs on bytes and may: UTF-8 is self-synchronizing, so a valid encoded needle cannot
   match starting inside a character. What had to change is the answer -- a byte offset is not a
   position in a string of characters. `("café".indexOf "f")` was 2 on both by luck (all-ASCII
   prefix) and would have been 4-vs-3 the moment the prefix was not. */
static int64_t ll_str_index_of(ll_str *s, ll_str *needle) {
  int64_t at = ll_str_find(s, needle, 0);
  return at < 0 ? -1 : ll_cp_index_of_offset(s, (size_t)at);
}

/* Same conversion `ll_str_index_of` got in Ff-3, and it was missed one function down: the scan runs
   on bytes (legitimately -- UTF-8 is self-synchronizing) but the ANSWER is a position in a string of
   characters. `("éécaféx".lastIndexOf "x")` returned the byte offset 9 where the codepoint index is
   6, while `.indexOf` next to it already answered correctly. */
static int64_t ll_str_last_index_of(ll_str *s, ll_str *needle) {
  int64_t found = -1, at = 0;
  for (;;) {
    int64_t next = ll_str_find(s, needle, at);
    if (next < 0) return found < 0 ? -1 : ll_cp_index_of_offset(s, (size_t)found);
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
  /* An empty separator splits into CHARACTERS, not bytes. (JS splits into UTF-16 code units here,
     which breaks a surrogate pair -- the residual astral-only gap noted in js-status.ts.) */
  if (sep->len == 0) {
    size_t i = 0;
    while (i < s->len) {
      size_t next = ll_cp_next_offset(s, i);
      ll_vec_grow(out, out->len + 1);
      out->items[out->len++] = ll_box_str(ll_str_from(s->data + i, next - i));
      i = next;
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

/* "" past either end rather than a trap -- that is what lets a scanner look one character ahead with
   no bounds test, and `io.lisp`'s format scanner leans on it. Characters, not bytes: this used to
   hand back one byte, i.e. half of an "é". */
static ll_str *ll_str_char_at(ll_str *s, int64_t i) {
  if (i < 0) return ll_str_lit("");
  size_t a = ll_cp_offset(s, i);
  if (a >= s->len) return ll_str_lit("");
  return ll_str_from(s->data + a, ll_cp_next_offset(s, a) - a);
}

static ll_str *ll_str_concat2(ll_str *a, ll_str *b) {
  ll_sb sb;
  ll_sb_init(&sb);
  ll_sb_put(&sb, a->data, a->len);
  ll_sb_put(&sb, b->data, b->len);
  return ll_sb_finish(&sb);
}

/* Width is a count of CHARACTERS, and so is the amount of filler taken from `pad`. Measured in bytes
   -- which is what both of these did -- `("café".padStart 6 "-")` produced `-café` here and `--café`
   on JS, because a 4-character string was measured as 5. */
static void ll_sb_put_pad(ll_sb *sb, ll_str *pad, int64_t need) {
  int64_t pad_n = ll_cp_length(pad);
  while (need > 0) {
    int64_t take = need < pad_n ? need : pad_n;
    size_t upto = ll_cp_offset(pad, take);
    ll_sb_put(sb, pad->data, upto);
    need -= take;
  }
}

static ll_str *ll_str_pad_start(ll_str *s, int64_t width, ll_str *pad) {
  int64_t n = ll_cp_length(s);
  if (n >= width || pad->len == 0) return s;
  ll_sb sb;
  ll_sb_init(&sb);
  ll_sb_put_pad(&sb, pad, width - n);
  ll_sb_put(&sb, s->data, s->len);
  return ll_sb_finish(&sb);
}

static ll_str *ll_str_pad_end(ll_str *s, int64_t width, ll_str *pad) {
  int64_t n = ll_cp_length(s);
  if (n >= width || pad->len == 0) return s;
  ll_sb sb;
  ll_sb_init(&sb);
  ll_sb_put(&sb, s->data, s->len);
  ll_sb_put_pad(&sb, pad, width - n);
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

/* `flat` -- ONE level, which is JS's default depth. Declared to the checker and implemented nowhere,
 * so it was the third member C refused outright rather than merely routing dynamically. A non-vec
 * element passes through unflattened, exactly as JS does. */
static ll_vec *ll_vec_flat(ll_vec *v) {
  ll_vec *out = ll_vec_new(v->len ? v->len : 4);
  for (size_t i = 0; i < v->len; i++) {
    ll_value e = v->items[i];
    if (e.tag == LL_VEC) {
      ll_vec *inner = e.as.v;
      for (size_t j = 0; j < inner->len; j++) ll_vec_push(out, inner->items[j]);
    } else {
      ll_vec_push(out, e);
    }
  }
  return out;
}

static ll_vec *ll_vec_concat(ll_vec *a, ll_vec *b) {
  ll_vec *out = ll_vec_new(a->len + b->len ? a->len + b->len : 4);
  for (size_t i = 0; i < a->len; i++) out->items[out->len++] = a->items[i];
  for (size_t i = 0; i < b->len; i++) out->items[out->len++] = b->items[i];
  return out;
}

/* `[a ...xs b]` and `(f a ...xs)` -- build a vector from `n` parts, splicing the spread ones.
 *
 * `spread[i]` non-zero means part i is a vector whose ELEMENTS go in; zero means the part is one
 * element. One helper serves both the literal and the argument list, because they are the same
 * operation -- which is also why a call carrying a spread has to go through the boxed convention:
 * the argument COUNT is not known until this has run.
 *
 * Spreading a non-vector TRAPS rather than passing the value through. JS throws a TypeError for
 * `[...5]`, and `ll_vec_flat` above deliberately passes non-vectors through because `flat` is
 * defined to -- borrowing that behaviour here would make `[...5]` mean something on C and throw on
 * JS, which is the silent divergence the backend split exists to prevent.
 *
 * Placed here rather than beside `ll_vec_of`: `ll_vec_push` is defined further down the file, the
 * same ordering that `ll_vec_grow`'s comment above already records.
 */
static ll_vec *ll_vec_build(size_t n, const int *spread, ll_value *parts) {
  ll_vec *out = ll_vec_new(n ? n : 4);
  for (size_t i = 0; i < n; i++) {
    if (!spread[i]) { ll_vec_push(out, parts[i]); continue; }
    ll_value p = parts[i];
    if (p.tag != LL_VEC) ll_trap("TypeError", "spread of a non-vector value");
    ll_vec *v = p.as.v;
    for (size_t j = 0; j < v->len; j++) ll_vec_push(out, v->items[j]);
  }
  return out;
}

/* `(f a ...xs)` -- build the argument list, then call through the boxed convention.
 *
 * A call carrying a spread cannot use the direct C convention at all: the argument COUNT is not
 * known until the spread has been walked, so the callee is reached as a value. That is why a spread
 * call is boxed even when the callee is an ordinary top-level function.
 */
static ll_value ll_call_spread(ll_value fn, size_t n, const int *spread, ll_value *parts) {
  ll_vec *v = ll_vec_build(n, spread, parts);
  return ll_call(fn, (int)v->len, v->items);
}

/* `(console.log ...xs)` -- a spread into a VARIADIC INTRINSIC, the third and last call shape spread
 * had to learn. The first two (a vector literal, a call to an l-lang function) landed with D75; this
 * one is different because the callee is a C function called directly, not a value passed to `ll_call`,
 * so there is nothing to hand a built argument list to.
 *
 * Building the vector and then passing `v->len, v->items` needs the vector TWICE, which a C expression
 * cannot do without a statement-expression (a GCC extension this runtime does not use). Passing the
 * function itself solves it: the helper holds the vector in a local and makes the call.
 *
 * TWO of them, split on the return type rather than cast between function pointer types, because
 * calling a function through an incompatible pointer type is undefined behaviour (C11 6.3.2.3p8) --
 * `ll_console_log` returns void and `ll_list` returns `ll_value`, and -fsanitize would flag the cast
 * even where it happens to work. Every variadic intrinsic takes `(int, ll_value *)`, so these two
 * cover all of them. */
static ll_value ll_spread_intrinsic(ll_value (*fn)(int, ll_value *), size_t n, const int *spread, ll_value *parts) {
  ll_vec *v = ll_vec_build(n, spread, parts);
  return fn((int)v->len, v->items);
}

static void ll_spread_intrinsic_void(void (*fn)(int, ll_value *), size_t n, const int *spread, ll_value *parts) {
  ll_vec *v = ll_vec_build(n, spread, parts);
  fn((int)v->len, v->items);
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

/* The vec half of `lastIndexOf`. The STRING half existed and `ll_dyn_method` had an arm for it, which
 * is what made this look routable -- it is not: the vec arm has no such entry, so a declared member
 * would have trapped at runtime instead of refusing at compile time. Measured, not assumed. */
static int64_t ll_vec_last_index_of(ll_vec *v, ll_value x) {
  for (size_t i = v->len; i > 0; i--) {
    if (ll_strict_eq(v->items[i - 1], x)) return (int64_t)(i - 1);
  }
  return -1;
}

/* -- dynamic (boxed-receiver) member dispatch -- the __ll_member mirror -------------------------- */

static int64_t ll_dyn_length(ll_value v) {
  switch (v.tag) {
    case LL_STR: return ll_str_len(v.as.s);
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
  /* A struct/class field on a boxed receiver (a pattern-bound `v`, an Unknown slot): slot by name. */
  if (recv.tag == LL_OBJ) {
    const ll_class *cls = recv.as.o->cls;
    for (size_t i = 0; i < cls->field_count; i++) {
      if (strcmp(cls->field_names[i], name->data) == 0) return recv.as.o->fields[i];
    }
  }
  ll_trap("TypeError", "value has no such member");
  return ll_nil();
}

/* Lvalue for a member STORE on a boxed receiver: `(c.mine := v)` where `c` is an array element or an
 * Unknown slot (tag LL_OBJ), or a map field. Returns a pointer to the slot so the caller can write it
 * -- the write-side analog of ll_dyn_member, mirroring ll_map_slot's pointer-return convention. */
static ll_value *ll_member_slot(ll_value recv, const char *name) {
  if (recv.tag == LL_OBJ) {
    const ll_class *cls = recv.as.o->cls;
    for (size_t i = 0; i < cls->field_count; i++) {
      if (strcmp(cls->field_names[i], name) == 0) return &recv.as.o->fields[i];
    }
    ll_trap("TypeError", "object has no such field");
  }
  if (recv.tag == LL_MAP) return ll_map_slot(recv.as.m, ll_box_str(ll_str_lit(name)));
  ll_trap("TypeError", "cannot assign a member of a non-object");
  return (ll_value *)0;
}

/* JS-like truthiness (for a predicate's boxed result): nil/false/0/0.0 are falsy, everything else true. */
static bool ll_truthy(ll_value v) {
  switch (v.tag) {
    case LL_NIL: return false;
    case LL_BOOL: return v.as.b;
    case LL_INT: return v.as.i != 0;
    case LL_REAL: return v.as.d != 0.0;
    default: return true;
  }
}

/* Higher-order vector methods: each drives a boxed op/predicate closure per element (ll_call). The
 * corpus reaches these through std/seq (`(coll.reduce op init)` etc.) -- a native vec method the JS
 * runtime gets from Array.prototype but a typed target must provide. */
static ll_value ll_vec_reduce(ll_vec *v, ll_value op, ll_value init) {
  ll_value acc = init;
  for (size_t i = 0; i < v->len; i++) { ll_value a[2] = {acc, v->items[i]}; acc = ll_call(op, 2, a); }
  return acc;
}
/* The right fold. Same shape as `ll_vec_reduce` walking backwards, and the accumulator stays the
 * FIRST argument to the operator -- matching `Array.prototype.reduceRight`, where the callback is
 * `(acc, element)` regardless of direction. Getting that backwards would make `compose` compose in the
 * wrong order and still typecheck. */
static ll_value ll_vec_reduce_right(ll_vec *v, ll_value op, ll_value init) {
  ll_value acc = init;
  for (size_t i = v->len; i > 0; i--) { ll_value a[2] = {acc, v->items[i - 1]}; acc = ll_call(op, 2, a); }
  return acc;
}
static ll_vec *ll_vec_map(ll_vec *v, ll_value fn) {
  ll_vec *out = ll_vec_new(v->len);
  for (size_t i = 0; i < v->len; i++) { ll_value a[1] = {v->items[i]}; ll_vec_push(out, ll_call(fn, 1, a)); }
  return out;
}
static ll_vec *ll_vec_filter(ll_vec *v, ll_value pred) {
  ll_vec *out = ll_vec_new(0);
  for (size_t i = 0; i < v->len; i++) { ll_value a[1] = {v->items[i]}; if (ll_truthy(ll_call(pred, 1, a))) ll_vec_push(out, v->items[i]); }
  return out;
}
static ll_value ll_vec_for_each(ll_vec *v, ll_value fn) {
  for (size_t i = 0; i < v->len; i++) { ll_value a[1] = {v->items[i]}; ll_call(fn, 1, a); }
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
    if (ll_dyn_name_is(name, "trimEnd")) return ll_box_str(ll_str_trim_end(s));
    /* `ll_str_len`, NOT `s->len`. This arm is the CALL position -- `(x.length)` on a boxed receiver --
       and it was the one place a raw byte count still escaped after Ff-3, which moved the read path
       (`ll_dyn_member` -> `ll_dyn_length`) and missed its sibling. So `"café"` measured 4 when read
       and 5 when called, on the same value in the same program. Pure BMP: not the astral gap. */
    if (ll_dyn_name_is(name, "length")) return ll_box_int(ll_str_len(s));
    if (ll_dyn_name_is(name, "slice"))
      return ll_box_str(ll_str_slice(s, argc > 0 ? ll_unbox_int(args[0]) : 0, argc > 1 ? ll_unbox_int(args[1]) : LL_END));
    if (ll_dyn_name_is(name, "indexOf")) return ll_box_int(ll_str_index_of(s, ll_unbox_str(args[0])));
    /* Absent entirely until now, so a boxed receiver trapped ("no such method on this value") where
       a statically-typed one worked -- `lastIndexOf` and the two pads reach `intrinsics.ts` on the
       typed path and had no dynamic arm at all. */
    if (ll_dyn_name_is(name, "lastIndexOf")) return ll_box_int(ll_str_last_index_of(s, ll_unbox_str(args[0])));
    if (ll_dyn_name_is(name, "padStart"))
      return ll_box_str(ll_str_pad_start(s, ll_unbox_int(args[0]), argc > 1 ? ll_unbox_str(args[1]) : ll_str_lit(" ")));
    if (ll_dyn_name_is(name, "padEnd"))
      return ll_box_str(ll_str_pad_end(s, ll_unbox_int(args[0]), argc > 1 ? ll_unbox_str(args[1]) : ll_str_lit(" ")));
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
    if (ll_dyn_name_is(name, "reduce")) return ll_vec_reduce(v, args[0], argc > 1 ? args[1] : ll_nil());
    if (ll_dyn_name_is(name, "reduceRight")) return ll_vec_reduce_right(v, args[0], argc > 1 ? args[1] : ll_nil());
    if (ll_dyn_name_is(name, "map")) return ll_box_vec(ll_vec_map(v, args[0]));
    if (ll_dyn_name_is(name, "filter")) return ll_box_vec(ll_vec_filter(v, args[0]));
    if (ll_dyn_name_is(name, "forEach")) return ll_vec_for_each(v, args[0]);
  }
  /* A user method on a statically-UNKNOWN object receiver (an interface value, an `Any` param): walk
   * the runtime class + its :extends chain for a method table entry, and call its boxed adapter. This
   * is the dispatch the C backend cannot devirtualize -- the witness/vtable the probe measured as A3
   * member-dyn. A child's table is checked before its parent's, so an override wins. */
  if (recv.tag == LL_OBJ && name.tag == LL_STR) {
    for (const ll_class *c = recv.as.o->cls; c; c = c->parent ? ll_class_by_name(c->parent) : (const ll_class *)0) {
      for (size_t i = 0; i < c->method_count; i++) {
        if (strcmp(c->methods[i].name, name.as.s->data) == 0) return c->methods[i].fn(recv, argc, args);
      }
    }
  }
  /* Not a known method: the __ll_member rule -- a non-function member is a field/property READ
   * (a struct field like `err.message`, a map key, `length`). Fall back to a member read. */
  if (argc == 0 && name.tag == LL_STR) return ll_dyn_member(recv, name.as.s);
  ll_trap("TypeError", "no such method on this value");
  return ll_nil();
}

/* ---------------------------------------------------------------------------------------------
 * D30's ITERATION PROTOCOL: `iter` gives a cursor, `next` advances it, nil means done.
 *
 * These existed only in the JS shim, so the C backend had no protocol at all: `resolveForEach`
 * special-cased vec and str and boxed everything else, and the emitter then wrote `ll_vec*` over it
 * unconditionally. A hand-written `Iterable` struct CRASHED the emitter (`no cast obj -> vec`, an
 * uncaught exception rather than a diagnostic), and an `Iterable<T>`-typed parameter compiled to
 * `ll_unbox_vec` and trapped at run time on anything that was not an array.
 *
 * A cursor is a CLOSURE for the built-in sequences and the USER'S OWN OBJECT otherwise. That split is
 * what keeps `ll_next` from needing to know anything: a closure is called, an object is asked for its
 * `next` method. No new tag, no cursor class, and nothing a user can accidentally construct -- a
 * 2-element vec used as a cursor would have been indistinguishable from a user's 2-element vec.
 * --------------------------------------------------------------------------------------------- */
typedef struct { ll_value src; int64_t i; int done; } ll_cursor_env;

/* `done` IS A FLAG, NOT A VALUE, and that is the whole of the fix below. See `ll_iter_done`. */
static ll_value ll_cursor_step(void *env, int argc, ll_value *argv) {
  (void)argc;
  (void)argv;
  ll_cursor_env *e = (ll_cursor_env *)env;
  if (e->src.tag == LL_VEC) {
    ll_vec *v = e->src.as.v;
    if (e->i >= (int64_t)v->len) { e->done = 1; return ll_nil(); }
    return v->items[e->i++];
  }
  if (e->src.tag == LL_STR) {
    ll_str *s = e->src.as.s;
    if (e->i >= ll_cp_length(s)) { e->done = 1; return ll_nil(); }
    return ll_box_str(ll_str_char_at(s, e->i++));
  }
  e->done = 1;
  return ll_nil();
}

static ll_value ll_iter(ll_value x) {
  /* D58: a generator instance IS its own cursor, answered without a method lookup. Taking this arm
   * before the `iterator()` dispatch is not merely an optimisation -- the synthesized frame class
   * carries no method table at all, so the general path would trap on it. */
  if (x.tag == LL_OBJ && x.as.o->cls->is_gen) return x;
  /* D30: an Iterable answers `iterator()`, and an Iterator IS an Iterable -- it answers `this`. A user
   * type that has neither is not iterable, and `ll_dyn_method` traps saying so. */
  if (x.tag == LL_OBJ) return ll_dyn_method(2, (ll_value[]){x, ll_box_str(ll_str_lit("iterator"))});
  if (x.tag == LL_CLOSURE) return x; /* already a cursor */
  /* TRAPS on anything else, deliberately, and this line is a correction to an earlier draft of it.
   *
   * The first version answered an empty cursor for nil and walked a MAP's keys -- which made C
   * iterate `(for :each k :from {:a 1})` while JS threw `m is not iterable`, because a plain Object
   * has no Symbol.iterator. That is a divergence INVENTED while fixing one, and the silent kind: C
   * would have quietly produced keys for a program that fails on the other backend.
   *
   * A map is not Iterable until something RULES that it is. Until then both backends refuse, and the
   * JS shim's own wording is the specification being matched here. */
  if (x.tag != LL_VEC && x.tag != LL_STR) ll_trap("TypeError", "value is not iterable");
  ll_cursor_env *e = (ll_cursor_env *)ll_gc_alloc(sizeof(ll_cursor_env), LL_H_CURSOR);
  e->src = x;
  e->i = 0;
  e->done = 0;
  return ll_box_closure(ll_closure_make(ll_cursor_step, e, 0, "cursor"));
}

/* Advance the cursor and answer the element. Whether the sequence is EXHAUSTED is a separate
 * question -- `ll_iter_done` below -- and that separation is the correction described there. */
static ll_value ll_next(ll_value it) {
  if (it.tag == LL_NIL) return ll_nil();
  if (it.tag == LL_CLOSURE) return ll_call(it, 0, (ll_value *)0);
  /* D58: resume the state machine directly. This is the per-ELEMENT path of every lazy pipeline, so
   * it deliberately does not go through `ll_dyn_method`'s name walk. */
  if (it.tag == LL_OBJ && it.as.o->cls->gen_step) return it.as.o->cls->gen_step(it.as.o);
  if (it.tag == LL_OBJ) return ll_dyn_method(2, (ll_value[]){it, ll_box_str(ll_str_lit("next"))});
  /* A raw sequence handed straight to `next` -- take a cursor over it and step once. Not useful on
   * its own, but it keeps `next` total rather than trapping on a plain array. */
  return ll_next(ll_iter(it));
}

/* IS THE CURSOR EXHAUSTED? A FLAG, not a sentinel value.
 *
 * This function exists because the previous rule -- "nil means done" -- was wrong, and the comment
 * that justified it said so out loud: "a sequence containing nil is not expressible anyway". It is.
 * `[1 nil 2]` is an ordinary vector, and under the old rule a walk of it STOPPED AT THE nil: C
 * rendered `[1,null,2]` as `[1]` while JS printed all three, silently, with no diagnostic. A leading
 * nil lost the whole container. D9's single bottom value is exactly why the sentinel cannot work --
 * "no more elements" and "an element that is nil" are the same value, so they cannot be the same
 * channel.
 *
 * The floor's neighbours dodge this and cannot lend their trick: `codepoint-at` answers -1 and
 * `file-open` answers -1 because a codepoint and a file descriptor are non-negative BY DEFINITION, so
 * a negative is genuinely out of band. `next` answers a `T?` for a `T` the floor cannot name -- there
 * is no value left over. A separate flag is the only total answer, which is C#'s
 * `MoveNext()`/`Current` split: advancing reports WHETHER there was an element, and the element is
 * read separately.
 *
 * TWO CURSOR KINDS, two answers:
 *
 *   * A BUILT-IN cursor (vector, string) is a closure over `ll_cursor_env`, identified by its own
 *     step function -- so the flag is read straight off the env and a nil ELEMENT is just an element.
 *   * A USER cursor is an object implementing D30's `(fn next [] -> T?)`, where nil genuinely is the
 *     only signal the protocol offers. It keeps the old rule, which is correct FOR THAT PROTOCOL
 *     rather than a fallback: a user iterator that must yield nil has to say so in its own type, and
 *     changing `Iterator<T>`'s shape is a language decision this is not.
 *
 * `last` is the value `ll_next` just produced, needed only for the second case. */
static int ll_iter_done(ll_value it, ll_value last) {
  if (it.tag == LL_CLOSURE && it.as.fn->fn == ll_cursor_step) {
    return ((ll_cursor_env *)it.as.fn->env)->done;
  }
  return last.tag == LL_NIL;
}

/* D58: release an ABANDONED sequence source. Total -- a value with no `dispose` member is left
 * alone, which is what lets `take` call it unconditionally on whatever it was handed.
 *
 * DUCK-TYPED rather than a `Disposable` type test, and that is an amendment to D58 rather than a
 * shortcut: `(x :of SomeInterface)` answers false on BOTH backends today, even for a type that
 * declares `:implements`, so the nominal test the ruling named does not exist to call. A member
 * check needs no type-system work and cannot be broken by that defect or by the one where
 * `:implements A B` records only the first interface (both in the gap ledger).
 *
 * A GENERATOR has no user cleanup to run -- LL0239 forbids a suspend inside a protected region, so
 * there is no `finally` to honour -- and it carries no method table either. Its disposal is to PARK
 * the machine: set the state to a value the dispatch does not name, so a later pull answers nil
 * instead of resuming into the middle of an abandoned body. */
static void ll_dispose(ll_value v) {
  if (v.tag != LL_OBJ) return;
  const ll_class *cls = v.as.o->cls;
  if (cls->is_gen) {
    if (cls->field_count > 0) v.as.o->fields[0] = ll_box_int(-1); /* GEN_DONE */
    return;
  }
  for (size_t i = 0; i < cls->method_count; i++) {
    if (strcmp(cls->methods[i].name, "dispose") == 0) {
      cls->methods[i].fn(v, 0, (ll_value *)0);
      return;
    }
  }
  /* A parent's `dispose` counts too -- conformance is inherited, so the walk is the same one
     `ll_dyn_method` performs rather than a shallower rule that would answer differently. */
  const char *parent = cls->parent;
  while (parent) {
    const ll_class *p = ll_class_by_name(parent);
    if (!p) break;
    for (size_t i = 0; i < p->method_count; i++) {
      if (strcmp(p->methods[i].name, "dispose") == 0) {
        p->methods[i].fn(v, 0, (ll_value *)0);
        return;
      }
    }
    parent = p->parent;
  }
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
/* JS Math.round: ties go toward +Infinity (so -1.5 -> -1, not C round()'s -2), and any x in
   [-0.5, -0] yields NEGATIVE zero. `floor(x + 0.5)` gets the ties right but returns +0 there, and the
   sign is OBSERVABLE: `console.log(-0)` prints `-0`. D51's own tie-break rule cites this case, and it
   is why `round` returns Real -- `-0` is not an Int value. */
static double ll_math_round(double x) {
  double r = floor(x + 0.5);
  if (r == 0.0 && (x < 0.0 || signbit(x))) return -0.0;
  return r;
}
static double ll_math_pow(double a, double b) { return pow(a, b); }
static double ll_math_min(double a, double b) { return a < b ? a : b; }
static double ll_math_max(double a, double b) { return a > b ? a : b; }
static double ll_math_random(void) { return (double)rand() / ((double)RAND_MAX + 1.0); }
static double ll_math_sign(double x) { return x > 0 ? 1.0 : x < 0 ? -1.0 : x; }
static double ll_math_trunc(double x) { return trunc(x); }
/* The sole Real -> Int door (D51 amendment (b)). Returns int64_t, not double, because that IS the
   conversion: `truncate` is where a Real becomes an Int, and every other numeric floor op stays
   Real-valued so the narrowing is always written down at the site that wants it. */
static int64_t ll_truncate(double x) { return (int64_t)trunc(x); }

/* BIT OPERATIONS (S2). Int only, 64-bit wrap, masked shifts, arithmetic shr.

   The shift COUNT is masked to 0-63 on both backends, and that is the load-bearing line here rather
   than a defensive habit: C leaves a shift by >= the operand width UNDEFINED (C11 6.5.7p3), so
   `(shl x 64)` would be whatever the hardware felt like -- typically `x` on x86, because the CPU masks
   the count itself, and 0 elsewhere. JS BigInt has no width at all and would shift by a million
   happily. Masking is the cheapest TOTAL rule both can implement exactly, and it agrees with what
   x86 and ARM already do.

   `ll_bit_shl` shifts through UINT64 and casts back. Left-shifting a negative int64_t, or shifting a
   1 into the sign bit, is also undefined in C (6.5.7p4) -- `-fwrapv` covers signed overflow in
   arithmetic but not this. The unsigned round trip is well-defined for every input and gives exactly
   the wrapping D51 already rules for Int.

   `ll_bit_shr` stays SIGNED, so it propagates the sign bit. That is implementation-defined rather
   than undefined in C (6.5.7p5), and every compiler this targets defines it as arithmetic; the JS
   side gets it for free because BigInt `>>` is arithmetic by definition. */
static int64_t ll_bit_and(int64_t a, int64_t b) { return a & b; }
static int64_t ll_bit_or(int64_t a, int64_t b) { return a | b; }
static int64_t ll_bit_xor(int64_t a, int64_t b) { return a ^ b; }
static int64_t ll_bit_not(int64_t a) { return ~a; }
static int64_t ll_bit_shl(int64_t a, int64_t n) {
  return (int64_t)((uint64_t)a << (n & 63));
}
static int64_t ll_bit_shr(int64_t a, int64_t n) { return a >> (n & 63); }
/* LOGICAL right shift: shift through UINT64 so the vacated high bits fill with 0, unlike `ll_bit_shr`
   which stays signed and propagates the sign. The JS twin reinterprets via BigInt.asUintN(64, ...). */
static int64_t ll_bit_ushr(int64_t a, int64_t n) { return (int64_t)((uint64_t)a >> (n & 63)); }

/* Refinement boundary check (D46 amend, P3c-1b-ii): the desugar wraps a value coerced INTO an
   Int-based refined newtype. Return v if it satisfies the (open-ended) interval, else PANIC -- a
   contract violation is a bug, not a catchable exception (it does NOT ll_throw, so it never crosses
   the floor; the recoverable path is a future D47 signal). clo/chi are 0/1 gates so an open bound is
   checked on one side only. */
/* Integer division and modulo (D85).
 *
 * A zero divisor PANICS, and deliberately does not route through `ll_trap`: a trap is catchable
 * (D82), and Sabaka's ruling puts a zero divisor on the CONTRACT side of that line rather than the
 * data side. So these sit beside `ll_refine_check_*` -- their own `fprintf` + `exit`, no handler
 * lookup, nothing to catch. The kind is spelled in the message because there is no object to build.
 *
 * `b == -1` is the OTHER guard, and it is not about zero at all. `INT64_MIN / -1` is 2^63, which does
 * not fit, and in C that is undefined behaviour rather than the wrap D51 promises -- on x86 the IDIV
 * instruction raises #DE and kills the process even under `-fwrapv`. Negating through `uint64_t` is
 * the defined spelling of the same value, so D51's wrap holds on every host. `a % -1` is 0 for all a,
 * including INT64_MIN, so the modulo guard needs no arithmetic at all. */
static int64_t ll_idiv(int64_t a, int64_t b) {
    if (b == 0) {
        fprintf(stderr, "ArithmeticError: division by zero\n");
        exit(1);
    }
    if (b == -1) return (int64_t)(0u - (uint64_t)a);
    return a / b;
}

static int64_t ll_imod(int64_t a, int64_t b) {
    if (b == 0) {
        fprintf(stderr, "ArithmeticError: modulo by zero\n");
        exit(1);
    }
    if (b == -1) return 0;
    return a % b;
}

static int64_t ll_refine_check_int(int64_t v, int64_t lo, int64_t hi, int64_t clo, int64_t chi) {
    if ((clo && v < lo) || (chi && v > hi)) {
        fprintf(stderr, "refinement violated: %lld is outside the declared range\n", (long long)v);
        exit(1);
    }
    return v;
}

static double ll_refine_check_real(double v, double lo, double hi, int64_t clo, int64_t chi) {
    if ((clo && v < lo) || (chi && v > hi)) {
        /* %g, matching how a Real is displayed elsewhere -- the message names the value the program
           actually had, and a %f here would print 300.000000 for a bound written 300. */
        fprintf(stderr, "refinement violated: %g is outside the declared range\n", v);
        exit(1);
    }
    return v;
}

/* Look up a class descriptor by name in the module registry (for the :extends chain walk). */
static const ll_class *ll_class_by_name(const char *name) {
  for (size_t i = 0; i < __ll_class_count; i++) {
    if (strcmp(__ll_class_registry[i]->name, name) == 0) return __ll_class_registry[i];
  }
  return (const ll_class *)0;
}

/* -- runtime type tests (D41 / spec A7). A generic's arguments are erased (`Int[]` tests "is an
 *    array"); nominal walks the :extends chain.
 *
 *    Int and Real are now SEPARATE, and that is a correction. This used to read
 *        strcmp(name,"Int")==0 || strcmp(name,"Real")==0  ->  tag==LL_INT || tag==LL_REAL
 *    with the comment "Mirrors JS __ll_is_type: Int/Real are one number" -- C has carried distinct
 *    LL_INT and LL_REAL tags all along and was deliberately discarding them so that `(5.5 :of Int)`
 *    would answer the same wrong `true` JS answered. That is A-0 upside down: the precise backend
 *    degraded to match the imprecise one. D51 removes the reason (JS gets a bigint tag), so C stops
 *    pretending. Reached only where the checker had no static type -- D43 folds the rest. */
static bool ll_is_type(ll_value v, const char *name, int primitive) {
  if (primitive) {
    if (strcmp(name, "Int") == 0) return v.tag == LL_INT;
    if (strcmp(name, "Real") == 0) return v.tag == LL_REAL;
    if (strcmp(name, "String") == 0) return v.tag == LL_STR;
    if (strcmp(name, "Boolean") == 0 || strcmp(name, "Bool") == 0) return v.tag == LL_BOOL;
    if (strcmp(name, "Char") == 0) return v.tag == LL_CHAR;
    if (strcmp(name, "Void") == 0) return v.tag == LL_NIL;
    return false;
  }
  if (strcmp(name, "Array") == 0) return v.tag == LL_VEC;
  if (strcmp(name, "Map") == 0) return v.tag == LL_MAP;
  /* Nominal struct/class identity: match the class OR any ancestor (walk the :extends chain). */
  if (v.tag == LL_OBJ) {
    for (const ll_class *c = v.as.o->cls; c; ) {
      if (strcmp(c->name, name) == 0) return true;
      /* INTERFACE conformance, which the `:extends` walk alone cannot see (D24 erases interfaces).
         Checked per level, so a parent's `:implements` counts for the child exactly as the class
         identity above does. */
      for (size_t i = 0; i < c->interface_count; i++) {
        if (strcmp(c->interfaces[i], name) == 0) return true;
      }
      c = c->parent ? ll_class_by_name(c->parent) : (const ll_class *)0;
    }
  }
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

/* -- reflection: `type` and `type-by-name` -- the metadata graph the JS backend emits as
 *    __ll_type_metadata. A class's metadata map carries "name" and "extends" (a NAME edge). -------- */

/* The reflection metadata graph (D54), assigned at the top of main from the SHARED builder both
   backends read. Before it existed, C could only answer from `ll_class`, which carries a name and a
   parent -- hence a two-key stub for a class and nil for a function. */
ll_map *__ll_meta = 0;

static ll_value ll_meta_lookup(const char *name) {
  if (!__ll_meta) return ll_nil();
  for (size_t i = 0; i < __ll_meta->len; i++) {
    if (strcmp(__ll_meta->keys[i]->data, name) == 0) return __ll_meta->vals[i];
  }
  return ll_nil();
}

/* The fallback shapes mirror the JS runtime's `|| { ... }` arms exactly -- same keys, same order. */
static ll_value ll_meta_or(const char *name, const char *kind) {
  ll_value m = ll_meta_lookup(name);
  if (m.tag != LL_NIL) return m;
  ll_str *keys[5]; ll_value vals[5];
  keys[0] = ll_str_lit("name");       vals[0] = ll_box_str(ll_str_lit(name));
  keys[1] = ll_str_lit("kind");       vals[1] = ll_box_str(ll_str_lit(kind));
  keys[2] = ll_str_lit("properties"); vals[2] = ll_box_vec(ll_vec_of(0, (ll_value *)0));
  keys[3] = ll_str_lit("methods");    vals[3] = ll_box_vec(ll_vec_of(0, (ll_value *)0));
  keys[4] = ll_str_lit("generics");   vals[4] = ll_box_vec(ll_vec_of(0, (ll_value *)0));
  return ll_box_map(ll_map_of(5, keys, vals));
}

static ll_value ll_class_meta(const ll_class *cls) {
  return ll_meta_or(cls->name, "class");
}

static ll_value ll_type(ll_value v) {
  /* D58/G3: a generator reflects as its SOURCE name with kind "generator", in the seeded
     `{name, kind, nullable}` shape -- and NOT through `ll_meta_or`, because the synthesized frame
     class never enters the metadata graph (a lookup would miss and then invent a 5-key class stub
     naming the frame type). The JS backend answers the same three keys from RuntimeProvider. */
  if (v.tag == LL_OBJ && v.as.o->cls->is_gen) {
    ll_str *k[3]; ll_value vals[3];
    k[0] = ll_str_lit("name");     vals[0] = ll_box_str(ll_str_lit(v.as.o->cls->name));
    k[1] = ll_str_lit("kind");     vals[1] = ll_box_str(ll_str_lit("generator"));
    k[2] = ll_str_lit("nullable"); vals[2] = ll_box_bool(false);
    return ll_box_map(ll_map_of(3, k, vals));
  }
  if (v.tag == LL_OBJ) return ll_meta_or(v.as.o->cls->name, "object");
  /* A function VALUE reports its DECLARATION, when it has one (Lb). `ll_closure` has carried the
     source name all along -- for the inspect format -- and this arm is the only reader that needed
     it, so `(type add)` answered `Function` while JS answered add's full params/returns. A lambda's
     name is not a declaration and falls through to `Function`, which is what JS now says too. */
  if (v.tag == LL_CLOSURE) {
    const char *fname = v.as.fn->name;
    if (fname && *fname) {
      ll_value m = ll_meta_lookup(fname);
      if (m.tag != LL_NIL) return m;
    }
    return ll_meta_or("Function", "function");
  }
  const char *nm = v.tag == LL_INT ? "Int" : v.tag == LL_REAL ? "Real" : v.tag == LL_STR ? "String"
                 : v.tag == LL_BOOL ? "Boolean" : v.tag == LL_VEC ? "Array" : v.tag == LL_MAP ? "Map"
                 : "Nil";
  return ll_meta_or(nm, "unknown");
}

static ll_value ll_type_by_name(ll_value name) {
  ll_str *nm = name.tag == LL_STR ? name.as.s : ll_to_str(name);
  return ll_meta_or(nm->data, "unknown");
}
