##using devtools to load the library
devtools::load_all()

library("TraMineR")

data(biofam)
##generating labels for the states
labels <- c("Parent",
            "Left",
            "Married",
            "Left+Marr",
            "Child",
            "Left+Child",
            "Left+Marr+Child",
            "Divorced" 
)
##defining the sequence object
biofam.seq <- seqdef(biofam, var = c(10:25), labels = labels)

## running om for sorting
om.const <-seqdist(biofam.seq, method ="OM", sm="CONSTANT")

## generating order variable
order <- cmdscale(om.const, k = 1 )
##sorting the sequence object according to the mds value
biofam.seq <- biofam.seq[order(order, decreasing=TRUE),]

## visualizing the seqplot 
## in case that the curves/trajectories are floating out of the image margins is your friend
## margins = c(top, left, bottom, right)
## position determines how the trajectories are aligned within each categorial state can be either "top" "center" "bottom"
seqaplot(biofam.seq, margins = c(150, 50, 250, 50), position = "top")
