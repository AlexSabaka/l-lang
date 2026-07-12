import { VERSION as COMPILER_VERSION, CompilerOptions, Context, LogLevel } from "./compiler";
import evalInScope from "./compiler/runtime/evalInScope";

document.onload = () => {
  // Scan document for l-lang scripts and evaluate them
  console.log(`l-lang Compiler Version: ${COMPILER_VERSION}`);

  // Combine global scope with window for browser environment
  const globalScopeObj = {} as any;
  globalScopeObj.window = window;
  globalScopeObj.document = document;

  const scripts = document.querySelectorAll(
    'script[type="text/lisp"], script[type="application/lisp"]'
  );

  function run(code: string) {
    const blob = new Blob([code], { type: "text/plain" });
    const file = new File([blob], "inline-script.lisp", { type: "text/plain" });

    const options: CompilerOptions = {
      minimumLogLevel: LogLevel.Error,
      includeRuntimeShim: true,
      language: "js",
      frontend: "grammar_v2",
      stage: "codegen",
      stdout: true,
    };
    const context = new Context(file.name, options);
    const js = context.process(file.name);

    evalInScope(js.code!, window);
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
