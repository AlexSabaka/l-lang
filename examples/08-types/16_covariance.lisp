;; Example: Covariance with read-only containers
;; Currently not enforced - marked as tech debt for future implementation

(definterface Producer<:out T>
  (fn produce [] -> T))

(defclass AnimalProducer :implements Producer<Animal>
  (fn produce [] -> Animal
    (return (Animal))))

(defclass DogProducer :implements Producer<Dog>
  (fn produce [] -> Dog
    (return (Dog))))

(let producer (DogProducer))
(console.log "Covariance example created")
