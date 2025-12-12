(
    ;; Export specific symbols
    (fn log [level msg] 
        (console.log '"[17:42] {(level)}: {(msg)}"))

    (export log)
)