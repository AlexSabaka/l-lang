(
    ;; 1. Enum Definition
    (defenum HttpMethod 
        :GET 
        :POST 
        :PUT 
        :DELETE)

    ;; 2. Struct Definition (Value type semantics)
    (defstruct Point
        (let :ctor x 0)
        (let :ctor y 0))

    (fn handle-request [method] (
        (match method {
            HttpMethod:GET  => "Fetching resource..."
            HttpMethod:POST => "Creating resource..."
            _               => "Unknown method"
        })
    ))

    (let p (Point 0 0))
    (p.x := 10)

    (console.log (handle-request HttpMethod:POST))
    (console.log (handle-request HttpMethod:GET))
    (console.log (handle-request HttpMethod:DELETE))

    (console.log f"Point {(p.x)}, {(p.y)}")
)