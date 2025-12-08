(
    ;; 1. Enum Definition
    (defenum HttpMethod 
        :GET 
        :POST 
        :PUT 
        :DELETE)

    ;; 2. Struct Definition (Value type semantics)
    (defstruct Point
        (let :public :ctor x 0)
        (let :public :ctor y 0))

    (fn handle-request [method] (
        (match method {
            HttpMethod.GET  => "Fetching resource..."
            HttpMethod.POST => "Creating resource..."
            _               => "Unknown method"
        })
    ))

    (let p (new Point))
    (p.x := 10)

    (std.console.log (handle-request HttpMethod.GET))
    (std.console.log '"Point: {(p.x)}, {(p.y)}")
)