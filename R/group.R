group_by <- function(graph){

  ##grouping the data?
  graph
}



sg_legend <- function(sg, show=FALSE, label="") {

  sg$x[[2]]$legend <- show
  sg$x[[2]]$legend_label <- label

  sg

}
