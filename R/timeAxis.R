tAxis <- function(graph, label = NULL, position = "top"){


  if (!is.null(label)) {

    graph$x[[2]]$xlabel <- label

    }

  graph
}
