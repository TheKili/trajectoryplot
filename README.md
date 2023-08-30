# Sequence _active_ plot

Sequence _active_ plot is an interactive version of the sequence index plot for R Studio. Within the method of Sequence Analysis, the sequence index plot is used to visually produce knowledge about the data, cluster algorithms and distance measurements. Within this process, interactvity helps to "make sense" out of the data and the calculated numbers. Different implementations of the sequence index plot exists. Yet, none of them is interactive. Sequence _active_ plot is written in JavaScript with the library [d3.js](https://d3js.org/) and mapped to R via the [html widgets package](https://www.htmlwidgets.org/).

## Installation

As a prerequisite, ```devtools``` needs to be installed: ```install.packages("devtools")```.
Next use the following command to download the sequence _active_ plot from GitHub: ```install_github("TheKili/seqaplot")```.
Now, you can use it simply as a R command: ```seqaplot(seqdata) ```.

## Usage
For the concrete usage, please refer to the R package documentation. Here are a few examples:

```R
library("TraMineR")
data(biofam)
biofam <- biofam[1:50, ]
biofam.seq <- seqdef(biofam, var = c(10:25))

##creating two plots of the same data set
seqaplot(list(biofam.seq,biofam.seq))
 ##including a tooltip with custom information
##creating multiple sort dropdowns
###creating the sorted variable first
sort_year <- row.names(biofam)[order(biofam$birthyr, decreasing=TRUE)]
sort_lang <- row.names(biofam)[order(biofam$plingu02, decreasing=TRUE)]
### passing it on to the sequence active plot
seqaplot(biofam.seq, sortv = list( list( var=sort_year, label="Sort by year" ), list( var=sort_lang, label="Sort by Language" )))
## creating a highlight dropdown
### creating a var containing TRUE/FALSE values (boolean masking)
protestants <- biofam$p02r01 == "Protestant or Reformed Church"
### passing it on to the sequence active plot
seqaplot(biofam.seq, highlight = list( list( var=protestant, label="Highlight if protestant" ))

```

## How to interactively make sense

A _tooltip_ function ensures that each individual life history can be viewed in detail. The displayed variables can be adjusted on sequence level. It is connected with a _fisheye_, which provides a magnifying glass effect. This allows the selected sequence to be viewed in even greater detail and a sense of visualization to be gained.

Following the logic of comparison, several _sequence state objects_ can be specified. The prerequisite is that these share the same Id at the sequence level. Each data set is represented in its own sequence index plot. These plots are interconnected and the currently highlighted sequence is also highlighted in the other plots. This allows for comparison of different distance measurements, or how the same sequence is located over multiple live channels.

![Two interconnected sequence index plots. The _fisheye_ makes the rectangles appear different sizes, a transparent tint and a dash at the left edge marks the highlighted sequence in both plots.]{width=100%}

The _sortv_ parameter allows for a list of variables. These are made available via dropdown menu in the visualization and their selection determines the sort order of the sequence index plot. The change can be observed live. This gives a sense for the duration of the re-sorting. The longer this lasts, the more fundamental the differences. At the same time, you can focus on specific areas of the plot and look at whether there is more or less re-sorting.

![Snapshot of the rearrangement of the plot. Here after at another distance measure.](Pasted%20image%2020230727002405.png)

This is especially useful in conjunction with the _highlight_ function. Because with this, some sequences can be highlighted in color, while the others are grayed out.
Should new groups form or old groups dissolve depending on the sorting used, this becomes visually apparent. For example, when using social origin as highlighting variable. Do sequences with the same social origin cluster in one distance measurement and dissolve within the other? Once again, you can either compare both plots by specifying two (or more) state sequence objects or by resorting them.

![With the _highligh_ function only those sequences remain colored which fulfill a certain condition. Here it is membership in a Protestant religion.](Pasted%20image%2020230727002249.png)


## Feedback, Improvements, Questions?
Please contact me at kili.ruess (at) web.de
