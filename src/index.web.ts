import { VERSION as COMPILER_VERSION } from "./compiler";
import { compileJS } from "./compiler/tools";
import * as lib from "./compiler/helpers/runtime/stdlib";

document.onload = () => {
  // Scan document for l-lang scripts and evaluate them
  console.log(`l-lang Compiler Version: ${COMPILER_VERSION}`);

  // Combine global scope with window for browser environment
  const globalScopeObj = lib.globalScope as any;
  Object.assign(globalScopeObj, window);
  globalScopeObj.window = window;
  globalScopeObj.document = document;

  const scripts = document.querySelectorAll(
    'script[type="text/lisp"], script[type="application/lisp"]'
  );

  function run(code: string) {
    const blob = new Blob([code], { type: "text/plain" });
    const file = new File([blob], "inline-script.lisp", { type: "text/plain" });

    const js = compileJS(file.name, { minimumLogLevel: 2 });
    if (js) {
      lib.evalInScope(js.code, lib.globalScope);
    }
  }

  scripts.forEach((script) => {
    // Select the src attribute
    const src = script.getAttribute("src");
    if (src) {
      // Fetch and compile external script
      fetch(src)
        .then((response) => response.text())
        .then(run)
        .catch((error) => {
          console.error(`Error loading l-lang script from ${src}:`, error);
        });
    }
    // Select the script content
    const code = script.textContent;
    if (code) {
      run(code);
    }
  });

  console.log("l-lang scripts evaluated.");
};
