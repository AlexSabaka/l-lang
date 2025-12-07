(
    ;; Export specific symbols
    (fn log [level msg] 
        (std.console.log '"[17:42] {(level)}: {(msg)}"))

    (export log)
)