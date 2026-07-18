;; String Operations
;;
;; This example demonstrates:
;; - String literals and concatenation
;; - String interpolation
;; - String methods and properties
;; - String manipulation

(
    ;; 1. String literals
    (let greeting "Hello, World!")
    (console.log "Basic string:" greeting)

    ;; 2. String concatenation
    (let first "John")
    (let last "Doe")
    (let fullname (+ first " " last))
    (console.log "Concatenated:" fullname)

    ;; 3. String interpolation
    (let name "Alice")
    (let age 28)
    (let message (+ "Name: " name ", Age: " age))
    (console.log "Interpolated:" message)

    ;; 4. String length
    (let text "JavaScript")
    (console.log "Length of '" text "':" text.length)

    ;; 5. Character access
    (let word "hello")
    (console.log "First char:" word[0])
    (console.log "Last char:" word[(- word.length 1)])

    ;; 6. String comparison
    (let str1 "apple")
    (let str2 "apple")
    (let str3 "banana")
    (if (== str1 str2)
        (console.log "str1 equals str2"))
    (if (!= str1 str3)
        (console.log "str1 not equals str3"))

    ;; 7. String case conversion
    (let mixed "HeLLo WoRLd")
    (let upper (mixed.toUpperCase))
    (let lower (mixed.toLowerCase))
    (console.log "Upper:" upper)
    (console.log "Lower:" lower)

    ;; 8. String searching
    (let sentence "The quick brown fox jumps over the lazy dog")
    (let index (sentence.indexOf "fox"))
    (console.log "Index of 'fox':" index)

    ;; 9. String slicing
    (let text-2 "JavaScript")
    (let substr1 (text-2.slice 0 4))  ;; "Java"
    (let substr2 (text-2.slice 4))     ;; "Script"
    (console.log "Slice [0:4]:" substr1)
    (console.log "Slice [4:]:" substr2)

    ;; 10. String splitting
    (let csv "apple,banana,orange")
    (let fruits (csv.split ","))
    (console.log "Split by comma:" fruits)

    ;; 11. String trimming
    (let padded "  hello  ")
    (let trimmed (padded.trim))
    (console.log "Before: '" padded "' Length:" padded.length)
    (console.log "After: '" trimmed "' Length:" trimmed.length)

    ;; 12. String checking methods
    (let email "user@example.com")
    (if (email.includes "@")
        (console.log "Valid email format indicator"))
    
    (let code "function test() { }")
    (if (code.startsWith "function")
        (console.log "Code starts with 'function'"))
    
    (let filename "document.pdf")
    (if (filename.endsWith ".pdf")
        (console.log "Is a PDF file"))

    ;; 13. String replacement
    (let template "Hello, {name}!")
    (let personalized (template.replace "{name}" "Charlie"))
    (console.log "Personalized:" personalized)

    ;; 14. String repetition
    (let pattern "ab")
    (let repeated (pattern.repeat 4))  ;; "abababab"
    (console.log "Repeated:" repeated)

    ;; 15. Template strings (if supported)
    (let x 10)
    (let y 20)
    (let result (+ "Sum of " x " and " y " is " (+ x y)))
    (console.log "Template:" result)
)
