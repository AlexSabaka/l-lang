# L-Lang P5.js 2D Platformer Example

This example demonstrates a 2D platformer game built with the L-Lang compiler and p5.js graphics library. It showcases:

1. **p5.js Integration**: Bindings for drawing, input, and graphics functions
2. **Game Physics**: Simple gravity-based platformer physics with collision detection
3. **Type Aliases**: Using `deftype` to create semantic type aliases
4. **State Management**: Mutable variables for player position, velocity, and collision state
5. **Functional Programming**: Higher-order functions and closures for game logic

## Files

- **main.lisp**: The game implementation in L-Lang
- **p5-bindings.lisp**: L-Lang wrapper functions for p5.js API
- **main.js**: Compiled JavaScript output
- **index.html**: Web page that loads and runs the game
- **style.css**: Styling for the game container

## Game Features

### Controls
- **← →**: Move left/right
- **Space**: Jump (when on ground)

### Game Elements
- **Red Rectangle**: The player character
- **Gray Rectangles**: Platforms to jump on
- **Blue Background**: Sky
- **Text Display**: Current X, Y position and ground state (debug info)

### Gameplay
- Jump from platform to platform
- Avoid falling off the bottom (resets to starting position)
- Features smooth gravity and collision detection

## How It Works

### Architecture

```
L-Lang Source (main.lisp)
  ↓
  Compiler (6 stages)
  ↓
JavaScript (main.js)
  ↓
P5.js Runtime
  ↓
Browser Canvas
```

### Key Implementation Details

#### P5.js Lifecycle

The game exports two functions that p5.js recognizes:

```lisp
(fn setup [] ...)   ;; Called once at startup
(fn draw [] ...)    ;; Called every frame (~60 FPS)
```

These are exposed to the `window` object inside the IIFE wrapper so p5.js can find them.

#### Physics

Gravity is applied every frame:
```lisp
(player-vy := (+ player-vy GRAVITY))  ;; Accelerate downward
(player-y := (+ player-y player-vy))  ;; Update position
```

Collision detection checks if the player overlaps with any platform:
```lisp
(fn on-platform [] (
    (mut on false)
    (for :each p :from platforms :then (
        ;; Check AABB (axis-aligned bounding box) collision
        (if (and (>= player-bottom (- py 2))
                 (<= player-bottom (+ py 2))
                 (>= player-x px-min)
                 (<= (+ player-x PLAYER-SIZE) px-max))
            (on := true)
        )
    ))
    (return on)
))
```

#### Input Handling

The game checks for held keys using p5.js' `keyIsDown()` function:

```lisp
(fn handle-input [] (
    (if (key-is-down LEFT-ARROW) (player-vx := (- PLAYER-SPEED)))
    (if (key-is-down RIGHT-ARROW) (player-vx := PLAYER-SPEED))
    (if (and (key-is-down SPACE) player-grounded) (player-vy := (- PLAYER-JUMP)))
))
```

## Running the Example

### Browser (Recommended)

1. Start a local web server in this directory:
   ```bash
   bash server.sh
   # or
   python3 -m http.server 8000
   ```

2. Open http://localhost:8000 in your browser

### Node.js (Command Line)

To compile and run just the JavaScript:
```bash
cd /Volumes/2TB/repos/l-lang
ts-node src/index.ts run examples/99-p5js/main.lisp
```

Note: This will only output the game state, not render graphics (since p5.js is a browser library).

## Compilation Details

### The Compilation Pipeline

1. **Parse**: L-Lang syntax → AST
2. **Syntax**: Grammar validation
3. **Symbols**: Symbol table + dependency resolution
4. **Desugar**: Normalize syntax (pipelines, implicit returns)
5. **Types**: Type inference and checking
6. **Codegen**: AST → JavaScript (ESTree → astring)

### Generated JavaScript Structure

```javascript
/**
 * Runtime preamble with helpers:
 * - __ll_deep_eq: Deep equality
 * - __ll_match_*: Pattern matching
 * - __ll_op_registry: Operator dispatch
 */

"use strict";
(function() {
  // All l-lang code runs here (module scope)
  
  const WIDTH = 800;
  const HEIGHT = 600;
  // ... game logic ...
  
  function setup() { /* ... */ }
  function draw() { /* ... */ }
  
  // Expose to window for p5.js
  if (typeof window !== 'undefined') {
    window.setup = setup;
    window.draw = draw;
  }
})();
```

## Testing the Deftype Feature

To test the new `deftype` (type alias) feature:

```bash
ts-node src/index.ts run examples/99-p5js/test_deftype.lisp
```

This creates a `Vector` type alias for `Point3D` and demonstrates that both names work identically:

```lisp
(deftype Vector Point3D)
(let v1 (new Vector 4 5 6))      ;; Works!
(console.log (== Vector Point3D)) ;; true
```

## P5.js Bindings

The `p5-bindings.lisp` file wraps essential p5.js functions:

- **Canvas**: `create-canvas`, `background`
- **Drawing**: `rect`, `ellipse`, `line`, `fill`, `stroke`, `no-fill`, `no-stroke`
- **Input**: `key-is-down`, arrow key constants (`LEFT-ARROW`, `RIGHT-ARROW`, etc.)
- **Text**: `text`, `text-size`
- **Transform**: `push`, `pop`, `translate`
- **Math**: `constrain`, `dist`
- **Animation**: `frame-rate`, `get-frame-rate`

Each binding is a simple pass-through:
```lisp
(fn rect [x y w h]
    (rect x y w h))  ;; Call p5.js rect directly
```

## Future Enhancements

Potential improvements to the platformer:

1. **Enemies**: Add moving obstacles with collision
2. **Collectibles**: Coins or power-ups to collect
3. **Levels**: Multiple platforms and challenges
4. **Animation**: Sprite animations instead of solid colors
5. **Sound**: Audio effects using p5.sound
6. **Vector2 Type**: Add 2D vector math (instead of using 3D vectors with z=0)
7. **Operator Overloads**: Support `+` and `-` for vectors directly

## Architecture Insights

### How deftype Works

The `deftype` keyword creates a type alias:

```lisp
(deftype Vector Vector3)  ;; Vector is now an alias for Vector3
```

This generates a const assignment in JavaScript:
```javascript
const Vector = Vector3;
```

Both `Vector` and `Vector3` refer to the same constructor function, enabling semantic naming without runtime overhead.

### Global Scope Exposure

L-Lang wraps all code in an IIFE (Immediately Invoked Function Expression) for module isolation. However, p5.js expects `setup()` and `draw()` to be global. The workaround:

```javascript
// Inside the IIFE, after defining setup and draw:
if (typeof window !== 'undefined') {
  window.setup = setup;
  window.draw = draw;
}
```

This exposes the functions to the global window object for p5.js to discover.

## Compiler Options

When compiling, you can use various flags:

```bash
# Performance profiling
ts-node src/index.ts transform --perf examples/99-p5js/main.lisp

# See specific compilation stage
ts-node src/index.ts transform --stage parse examples/99-p5js/main.lisp
ts-node src/index.ts transform --stage types examples/99-p5js/main.lisp

# Generate source maps
ts-node src/index.ts transform --source-map examples/99-p5js/main.lisp
```

## Debugging Tips

1. **Check Generated Code**: Look at `main.js` to see what JavaScript was generated
2. **Browser Console**: Open DevTools (F12) to see any runtime errors
3. **Parse Stage**: Use `--stage parse` to verify syntax is correct
4. **Type Checking**: Use `--stage types` to see type inference results
5. **Performance**: Use `--perf` flag to identify bottlenecks

## References

- [P5.js Documentation](https://p5js.org/)
- [L-Lang Compiler Guide](https://github.com/yourusername/l-lang)
- [Platformer Game Physics](https://en.wikipedia.org/wiki/Platformer)
- [AABB Collision Detection](https://developer.mozilla.org/en-US/docs/Games/Techniques/2D_collision_detection)
