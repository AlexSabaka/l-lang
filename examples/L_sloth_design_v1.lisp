(using [
    AutoMapper
    Microsoft.AspNetCore.JsonPatch
    Microsoft.AspNetCore.Mvc
    { JsonSerializer } from System.Text.Json
    { FoodDto } from SampleWebApiAspNetCore.Dtos
    { Food } from SampleWebApiAspNetCore.Entities
    { IFoodsRepositroy } from SampleWebApiAspNetCore.Repositories
])

;; (using AutoMapper)
;; (using Microsoft.AspNetCore.JsonPatch)
;; (using Microsoft.AspNetCore.Mvc)
;; (using { JsonSerializer } from System.Text.Json)
;; (using { FoodDto } from SampleWebApiAspNetCore.Dtos)
;; (using { Food } from SampleWebApiAspNetCore.Entities)
;; (using { IFoodsRepositroy } from SampleWebApiAspNetCore.Repositories)

(namespace SampleWebApiAspNetCore.Controllers.v1)

;; :where T :is A            – strict constrait T == A
;; :where T :extends A       – constrait on children of A, T can be A or any of child
;; :where T :implements IA   – T matches interface IA definition, if IA defines M1 and M2 and T not implements IA explicitly but also defines M1 and M2 then T "implements" IA

;; definterface – interfaces definitions (duh...)
;; defclass – class definition (duh x2...)
;; deftype – types/classes/interfaces compositions, unios, intersections, etc, etc
;; defstruct – for .NET compatibility
;; defrectord – for .NET compatibility

(definterface :internal IRepository<TEntity> :where TEntity :is class new()
    (async fn GetAll [query-params] -> IQueryable<TEntity>)
    (async fn GetById [query-params] -> TEntity)
)
(definterface :internal IFoodsRepositroy :implements IRepository<Food>)
(definterface :internal IFruitsRepositroy<TFood> :implements IRepository<TFood> :where TFood :extends Fruit)
(deftype :internal Borsch :extends Food :is Carrot & Potato & Cabbage & Porkbelly & Beatroot)
(deftype :internal Vegetable :is Carrot | Potato | Cabbage)
(definterface :internal IBorschRepository :implements IFoodsRepository<Borsch>)

;; Almost the same as C# does
(deftype IInterface<TA,TB>
    :extends IA IB IC ID
    :where TA :extends A
    :where TB :implements IB

    (let :readonly IsAccessible <- boolean)
    (let :readonly [P keyof TA] <- TA[P])
    (let :readonly [P keyof TB] <- TB[P])
)

;; Basically let :readonly does same as simple let, but :readonly should be for .NET compatibility
(deftype ReadOnly<T> :is {
    (let :readonly [P keyof T] <- T[P])
})

(deftype IsAvailable<T> :is {
    ; Only two posible ways to use key selectors:
    ; 1 with a string formatting to create new key names
    ;   based on original names
    ; 2 
    (let :readonly ['"IsAvailable{P}" where P keyof T] <- T[P])
    (let :readonly ['"{P}WithMetadata" where P keyof T] <- { data <- T[P], meta <- Meta<T[P]> })
    (let :readonly [P keyof T] <- T[P])
})


(defclass :public StringWrapper (
    (mut :public bytes <- Ref<Vec<u8>>)
    (fn :public len [] -> uint (|> bytes .own .len))
    (fn :public is_empty [] -> boolean (|> bytes .own .is_empty))
))

(defclass :private EntityUtils<T>
    :implements IEntityUtils, IUtilsRepository
    :where T :has ctor :implements IEntity :inherits BaseEntity
    (let :private :readonly :ctor dbContext <- DbContext)
)

(defenum :public SomeEnum :with Flags {
    :Key1 => 123
    :Key2 => 321
})

;; for type guards should exist operator typeof
;; but any should not be the same as object (System.Object)
;; even though they are looks almost identical
(fn isString [x <- any] -> boolean (do
    (return (match x {
        s -> System.String => true
        _ => false
    }))
))

(fn ?<T> [cond :default false <- (boolean | string), a <- T, b <- T]
    -> T :where T :is class, ctor()
    (match cond {
        true => a,
        false => b,
    })
)

(async fn sql<T> [query <- ASTQuote] -> T[] (
    ; ...
))

(async fn searchWarehouse [searchQuery <- string] -> Product[] (return
    (sql<Product> '(
        SELECT p.Id, p.Price, p.Title, p.Description, p.Quantity
        FROM dbo.Warehouse
        WHERE p.Quantity > 0 AND p.Title LIKE searchQuery
        ORDER BY p.Price DESC
    ))
))


(async fn is-all-odd [x <- IEnumerable<int>] -> bool (do
    (return (match (callHttpService x) {
        { :Status TaskStatus.Completed :Result res } => (match res {
            { :error err :data null } => (throw Exception $"Something happened {err}")
            { :error null :data items } => (all items)
        })
        { :Status TaskStatus.Failed :Exception ex } => (throw ex)
    }))
))

(async fn is-all-odd [x <- IEnumerable<int>] -> bool (do
    (return (match (await callHttpService x) {
        { :error err :data null } => (throw Exception $"Something happened {err}")
        { :error null :data items } => (all items)
    }))
))

(async fn is-all-even [x <- IEnumerable<int>] -> bool (do
  (let res (await
    (x
     |> callAnotherHttpService
     |> Task.WhenAll)))
  (return res.All)
))

(async fn *is-all-even* [x <- IEnumerable<int>] -> bool (do
  (let res (await
    (x  ; pass x down the function chain
        ; if x is enumerable of T and otherAsyncFunction accepts enumerable of T – passed as is
        ; if x is enumerable of T and otherAsyncFunction accepts T – elements of x passed down
      |> otherAsyncFunction *second-arg*
        ; and here is enumerable of task of T and Task.WhenAll accepts enumerable of task
        ; so passed as is
      |> Task.WhenAll)))
  (return res.All)
))

(defmacro sql [data <- quote] -> quote (

))

(fn parse [s <- string] (do
  (let num /attr|perf|/gmi)
))

;; Match
;; Constant pattern
;; Identifier pattern
;; Type pattern
;; List patern
;; Vector pattern
;; Map pattern
;; Expression pattern
;;  Function match


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
            _ => (Console.WriteLine "are you still alive")
        })
    ))

    (fn :static Test2 [] (do
      (mut numList (|> Console.ReadLine (.Split " ") int.Parse .ToList))
      (return (Test2 numList))
    ))

    (fn Test2 [numList <- int[]] (do
        (let sum numList.Sum)
        (let avg (/ sum numList.Count))
        (let sq (fn [x <- int] (^ x 2)))
        (let rms (sqrt (/ (|> numList sq .Sum) numList.Count)))
        (return (tuple avg rms))
    ))
)

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
    (let :ctor _mapper <- IMapper)
    (let :ctor _logger <- ILogger<FoodsController>)

    (async fn :public GetAll [version query-params :with FromQuery]
        :with HttpGet -> IActionResult (do
        (mut foods-query (_foodRepo.GetAll query-params))
        (mut paged-food
            (|> foods-query
                skip (* query-params.PageSize query-params.Page)
                take query-params.PageSize
                project-to<FoodDto> _mapper.Configuration
                to-list))
        (mut pagination-metadata {
            :TotalCount (foods-query.Count)
            :PageSize query-params.PageSize
            :Page query-params.Page
            :TotalPages (Int32 (infix foods-query.Count / query-params.PageSize))
        })
        (Response.Headers.Add "X-Pagination" (JsonSerializer.Serialize pagination-metadata))
        (return (Ok {
            :data paged-food
            :pagination pagination-metadata
        }))
    ))
)


;  Performance optimizations
;@ +perf inline stalloc unsafe-code
;@ -perf inline unsafe-code

;  Linter options
;@ +lint unused-vars impure-functions auto-prettier
;@ -lint unused-vars impure-functions

;  Warnings
;@ +warning LL0001 LL0003
;@ -warning LL0001 LL0003

;  Defines
;@ +def DEBUG
;@ -def DEBUG

;  Conditionals "+if" adds next block to build if DEBUG is define, "-if" removes
;@ +if DEBUG
;@ -if DEBUG

(defclass :internal :static Program
    (fn :static Main [args] (do
        ;; here is clear distinguishment between instanse methods (starts with a dot)
        ;; and other methods
        ;; idk about extensions methods 
        ((Host.CreateDefaultBuilder args)
            |> .ConfigureWebHostDefaults (fn [builder] (builder.UseStartup<Startup>))
            |> ConfigureLogging
            |> .Build
            |> .Run
        )
    ))

    (fn :static ConfigureLogging [builder <- WebHostBuilder] -> WebHostBuilder (do
        ;; ...
        (return builder)
    ))
)

(
  (defclass Something<M,N> :implements ISomething (
    (fn hasSomething [data <- T] -> boolean
      (return (> data 0)))

    (fn hasSomething [data <- T] -> boolean
      (return (contains data '"something {(select top 10 even from data)} something")))
  ))
)
