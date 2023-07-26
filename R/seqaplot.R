## =============================
## Plotting individual sequences
## =============================

seqaplot <- function(seqdata, group = NULL, ...) {
  seqplot(seqdata, group=group, type="i", ...)
  }
seqAplot <- function(seqdata, group = NULL,  ...) {
  seqplot(seqdata, group=group, type="I",  ...)
}
