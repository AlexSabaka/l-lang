(
  (fn strlen [s] s.length)
  (fn substr [s start end] (s.slice start end))
  (fn upcase [s] (s.toUpperCase))
  (fn downcase [s] (s.toLowerCase))
  (fn trim [s] (s.trim))
  (fn split [s sep] (s.split sep))
  (fn join [arr sep] (arr.join sep))
  (fn contains [s sub] (s.includes sub))
  (fn starts-with [s prefix] (s.startsWith prefix))
  (fn ends-with [s suffix] (s.endsWith suffix))

  (export strlen substr upcase downcase trim split join contains starts-with ends-with)
)