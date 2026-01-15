;; (using AutoMapper)
;; (using Microsoft.AspNetCore.JsonPatch)
;; (using Microsoft.AspNetCore.Mvc)
;; (using { JsonSerializer } from System.Text.Json)
;; (using { FoodDto } from SampleWebApiAspNetCore.Dtos)
;; (using { Food } from SampleWebApiAspNetCore.Entities)
;; (using { IFoodsRepositroy } from SampleWebApiAspNetCore.Repositories)

;; :where T :is A            – strict constrait T == A
;; :where T :extends A       – constrait on children of A, T can be A or any of child
;; :where T :implements IA   – T matches interface IA definition, if IA defines M1 and M2 and T not implements IA explicitly but also defines M1 and M2 then T "implements" IA

;; definterface – interfaces definitions (duh...)
;; defclass – class definition (duh x2...)

;; deftype – types/classes/interfaces compositions, unios, intersections, etc, etc

;; defstruct – 
;; defrectord – 

(defmodifier memoized []
    (let lookup-table {})
    (return fn [fn ...args] (
        (let args-hash (args.reduce (fn [x a] (+ a x)) args.length))
        (if (lookup-table.includes args-hash)
            (return lookup-table[args-hash])
            (
                (let result (fn ...args))
                (lookup-table[args-hash] := result)
                (return result)
            )
        )
    ))
)

(fn :memoized fib [n <- Int] -> Int
    (match n {
        0 => 1
        1 => 1
        _ => (+ (fib (- n 1))
                (fib (- n 2)))
    })
)

(definterface :internal IRepository<TEntity> :where TEntity :is class new()
    (async fn GetAll [query-params] -> IQueryable<TEntity>)
    (async fn GetById [query-params] -> TEntity
))

(definterface :internal IFoodsRepository :implements IRepository<Food>)

(definterface :internal IFruitsRepository<TFood> :implements IRepository<TFood>
    :where TFood :extends Fruit)

(deftype :internal Borsch :extends Food :is Carrot & Potato & Cabbage & Porkbelly & Beatroot)
(deftype :internal Vegetable :is Carrot | Potato | Cabbage)

(definterface :internal IBorschRepository :implements IFoodsRepository<Borsch>)


;; Almost the same as C# does
(definterface IInterface<TA, TB>
    :where TA :extends A
    :where TB :implements IB

    (let :readonly IsAccessible <- Boolean)
    (let :readonly [P keyof TA] <- TA[P])
    (let :readonly [P keyof TB] <- TB[P])
)


;; Basically let :readonly does same as simple let,
;; but :readonly should be for .NET compatibility
(deftype ReadOnly<T> {
    (let :readonly [P keyof T] <- T[P])
})


(deftype IsAvailable<T> {
    ; Only two possible ways to use key selectors:
    ; 1 with a string formatting to create new key names
    ;   based on original names
    ; 2 
    (let :readonly ['"IsAvailable{P}" :where P keyof T] <- T[P])
    (let :readonly ['"{P}WithMetadata" :where P keyof T] <- { data <- T[P], meta <- Meta<T[P]>})
    (let :readonly [P keyof T] <- T[P])
})


(deftype uint8 Int :where Int :is (0 .. 255))

(defstruct :public StringWrapper
    (mut :private :stack bytes <- uint8[256] [0])
    (mut :private :stack length <- uint8 0)

    (fn len [] -> uint8 this.length)
    (fn is_empty [] -> Boolean this.length)

    (fn :operator * [count <- Int] -> StringWrapper
        (when (or (<= count 0) (== this.length 0))
            (return this)
        )
        (for 
            :init (mut i 0)
            :cond (< i this.length)
            :step (i := (+ i 1))
            :then (for 
                :init (mut j 0)
                :cond (< j count)
                :step (j := (+ j 1))
                :then (this.bytes[(+ (* i count) j)] := this.bytes[i])
            )
        )
        (return this)
    )
)


(defclass :private EntityUtils<T>
    :implements IEntityUtils & IUtilsRepository
    :where T :has ctor :implements IEntity :inherits BaseEntity

    (let :private :readonly :ctor dbContext <- DbContext)
)


(let :public SomeMap {
    :Key1 => 123
    :Key2 => 321
})


(defenum :public SomeEnum :with Flags
    :Key1 => 123
    :Key2 => 321
)



;; for type guards should exist operator typeof
;; but any should not be the same as object (System.Object)
;; even though they are looks almost identical
(fn isString [x <- Any] -> Boolean
    (match x {
        s -> String => true
        _ => false
    })
)



(fn ?<T> [cond :default false <- Boolean | string a <- T b <- T]
    -> T :where T :is class, ctor
        (match cond {
            #t => a
            #f => b
        })
)


(async fn sql<T> [query <- ASTQuote] -> T[] ())
    ; ...



(async fn searchWarehouse [searchQuery <- string] -> Product[] (return
    (sql<Product> '(
        SELECT p.Id, p.Price, p.Title, p.Description, p.Quantity
        FROM dbo.Warehouse
        WHERE p.Quantity > 0 AND p.Title LIKE searchQuery
        ORDER BY p.Price DESC))))

(async fn is-all-odd [x <- IEnumerable<int>] -> bool (do
(return (match (callHttpService x) {
{ :Status TaskStatus.Completed :Result res } => (match res {
{ :error err :data null } => (throw Exception $"Something happened {err}")
{ :error null :data items } => (all items)})

{ :Status TaskStatus.Failed :Exception ex } => (throw ex)}))))







;; Match
;; Constant pattern
;; Identifier pattern
;; Type pattern
;; List patern
;; Vector pattern
;; Map pattern
;; Expression pattern
;; Function match


(defclass :static MiscTests
    (fn :static Test1 [] (do
                          (mut age (|> Console.ReadLine int.Parse))
                          (match age {
                                      (s <- string)    => ()
                                      (1     2      3) => ()
                                      (fn [x] (| (= x 0) (< x -0))) => (Console.WriteLine "unborn")
                                      (fn [x] (& (> x 0) (< x 10))) => (Console.WriteLine "just a baby")
                                      (fn [x] (< x 20)) => (Console.WriteLine "yo yo yo a teenager here")
                                      (fn [x] (< x 40)) => (Console.WriteLine "nothing spectacular a middleage man")
                                      (fn [x] (< x 60)) => (Console.WriteLine "i see youve seen some shit in life")
                                      (fn [x] (< x 90)) => (Console.WriteLine "have you bought yourself a place at graveyard")
                                      _ => (Console.WriteLine "are you still alive")})))
        
    

    (fn :static Test2 [] (do
                          (mut numList (|> Console.ReadLine (.Split " ") int.Parse .ToList))
                          (return (Test2 numList))))
    

    (fn Test2 [numList <- int[]] (do
                                  (let sum numList.Sum)
                                  (let avg (/ sum numList.Count))
                                  (let sq (fn [x <- int] (^ x 2)))
                                  (let rms (sqrt (/ (|> numList sq .Sum) numList.Count)))
                                  (return (tuple avg rms)))))
    


(defclass FoodDto
    (let :ctor Title <- string)
    (let :ctor Description <- string)
    (let :ctor Nutrients :with JsonIgnore <- map<string, number>)
)


[ApiController]
[ApiVersion "1.0"]
[Route "api/v{version:apiVersion}/[controller]"]
(defclass :internal FoodsController :inherits Controllerbase
    :with ApiController
    :with ApiVersion "1.0"
    :with Route "api/v{version:apiVersion}/[controller]"

    (let :ctor _foodRepo <- IFoodsRepositroy<Food>)
    (let :ctor _logger <- ILogger<FoodsController>)

    (async fn :public GetAll [version <- String query-params :with FromQuery <- Any]
        :with HttpGet -> IActionResult<FoodDto[]>
            (mut foods-query (_foodRepo.GetAll query-params))
            (mut paged-food foods-query |>
                    .skip (* query-params.PageSize query-params.Page)
                    .take query-params.PageSize
                    .to-list)
            (mut pagination-metadata {
                :TotalCount (foods-query.Count)
                :PageSize query-params.PageSize
                :Page query-params.Page
                :TotalPages (Int32 (infix foods-query.Count / query-params.PageSize))
            })
            (Response.Headers.Add "X-Pagination" (JSON.stringify pagination-metadata))
            (return (Ok {
                :data paged-food
                :meta pagination-metadata
            }))
    )
)

;; here is clear distinguishment between instanse methods (starts with a dot)
;; and other methods
;; idk about extensions methods 
(defclass :internal :static Program
    (fn :static Main [args] (do
        ((Host.CreateDefaultBuilder args)
            |> .ConfigureWebHostDefaults (fn [builder] (builder.UseStartup<Startup>))
            |> .ConfigureLogging
            |> .Build
            |> .Run)))


(defclass Something<M,N> :implements ISomething
    (fn hasSomething [data <- T] -> Boolean
        (> data 0)
    )

    (fn hasSomething [data <- T] -> Boolean
        (contains data '"something {(select top 10 even from data)} something")
    )
)
