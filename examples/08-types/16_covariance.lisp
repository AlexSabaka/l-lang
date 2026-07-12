;; Example: Covariance with read-only containers.
;;
;; `:out T` means a Producer only ever PRODUCES a T, never consumes one -- so a Producer<Dog> is
;; safely usable wherever a Producer<Animal> is wanted. `describe` asks for a Producer<Animal> and
;; is handed a Producer<Dog>; that is the whole point of the example, and until P7d it was a type
;; error, because isAssignable(Dog, Animal) was false and the `<Dog>` of `:implements Producer<Dog>`
;; was discarded by both parsers.

(defclass Animal
  (fn speak [] -> String (return "...")))

(defclass Dog :extends Animal
  (fn speak [] -> String (return "Woof")))

(definterface Producer<:out T>
  (fn produce [] -> T))

(defclass AnimalProducer :implements Producer<Animal>
  (fn produce [] -> Animal
    (return (Animal))))

(defclass DogProducer :implements Producer<Dog>
  (fn produce [] -> Dog
    (return (Dog))))

(fn describe [p <- Producer<Animal>] -> Void
  (console.log "Covariance example created"))

;; The covariant assignment: a Producer<Dog> where a Producer<Animal> is expected.
(let producer <- Producer<Dog> (DogProducer))
(describe producer)
