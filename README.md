# Sequence _active_ plot

Sequence _active_ plot is an interactive version of the sequence index plot for R Studio. Within the method of Sequence Analysis, the sequence index plot is used to visually produce knowledge about the data, cluster algorithms and distance measurements. Within this process, interactvity helps to "make sense" out of the data and the calculated numbers. Different implementations of the sequence index plot exists. Yet, none of them is interactive. Sequence _active_ plot is written in JavaScript with the library [d3.js](https://d3js.org/), [svelte](https://svelte.dev/)  and mapped to R via the [html widgets package](https://www.htmlwidgets.org/).

## Installation

As a prerequisite, ```devtools``` needs to be installed: ```install.packages("devtools")``` and load it ```library(devtools)```.
Next use the following command to download the sequence _active_ plot from GitHub: ```install_github("TheKili/seqtrajectoryplot")```.
Now, you can use it simply as a R command: ```seqaplot(seqdata) ```.

## Usage
Refer to the `example.R`file for a minimal working example.
