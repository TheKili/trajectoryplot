## =============================
## Plotting individual sequences
## =============================

seqiplot <- function(seqdata, group = NULL, ...) {
  seqplot(seqdata, group=group, type="i", ...)
  }
seqIplot <- function(seqdata, group = NULL,  ...) {
  seqplot(seqdata, group=group, type="I",  ...)
}
