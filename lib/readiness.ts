export function calculateReadiness({
  free_ers,
  icu_beds,
  physicians,
  specialists,
}: {
  free_ers: number
  icu_beds: number
  physicians: number
  specialists: number
}) {
  return (
    free_ers * 0.4 +
    icu_beds * 0.3 +
    physicians * 0.2 +
    specialists * 0.1
  )
}