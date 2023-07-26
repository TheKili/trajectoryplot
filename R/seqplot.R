## ====================================================
## Generic function for plotting state sequence objects
## ====================================================

#### code copied from TramineR and adjusted only###

seqplot <- function(seqdata, group = NULL, type ="i", main = NULL, cpal = NULL, missing.color = NULL, ylab=NULL, yaxis = TRUE,
                  axes = "all", xtlab = NULL, ltext = NULL, legend = NULL, legend.prop = NA, flexwrap = "wrap",
                  rows = NA, cols = NA, tooltip = NULL, width = "100%", height = NULL, barWidth = 20, barHeight = 2, margins = c(20,20,20,20),  xlabel = NULL, title, cex.plot, withlegend,
                  paddingInnerX = 0.01, paddingInnerY = 0, sliderX = list( visible = FALSE, range = c(0,1)), sortv= NULL, fisheye = NULL, marks = NULL, highlight = NULL, ...){


if (typeof(seqdata) == "list"){
  if (inherits(seqdata,"stslist")) seqdata <- list(seqdata)
  else{
      for(dataSet in seqdata){
        if (!inherits(dataSet, "stslist"))
        stop(call.=FALSE, "seqplot: data is not a state sequence object, use seqdef function to create one")
    }

  }
}



oolist <- list(...)

if(typeof(sortv) == 'character'){

  sortv <- list(var=sortv, nodropdown = TRUE)
}



##========
##Plotting
##========

olist <- oolist


## ToDo: ordentliches Interfaces welches checkt, ob die Werte nicht schon defined sind
## extracting information from state sequence object
datalist <- list()
paramlist <-list()
for (dataSet in seqdata){

    names <- attr(dataSet, "names")
    row.names <- attr(dataSet, "row.names")
    start <- attr(dataSet, "start")
    missing <- attr(dataSet, "missing")
    nr <- attr(dataSet, "nr")
    alphabet <- attr(dataSet, "alphabet")
    class <- attr(dataSet, "class")
    labels <- attr(dataSet, "labels")
    weights <- attr(dataSet, "weights")
    if(is.null(cpal)) cpal <- attr(dataSet, "cpal")
    missing.color <- attr(dataSet, "missing.color")
    xtstep <- attr(dataSet, "xtstep")
    tick.last <- attr(dataSet, "tick.last")


    plist <- list(names = names, row.names = row.names, xtstep = xtstep, cpal=cpal, missing.color=missing.color,
                  yaxis=yaxis, xtlab=xtlab, labels = labels, alphabet = alphabet,
                  barWidth = barWidth, barHeight = barHeight, xlabel = xlabel, width = width, flexwrap = flexwrap,
                  margins = margins, paddingInnerX = paddingInnerX, paddingInnerY = paddingInnerY, legend = legend, tooltip = tooltip, sortv = sortv, fisheye=fisheye, marks = marks, highlight = highlight )

      datalist[[length(datalist) + 1]] =list( cbind(dataSet), plist)

}


  attr(datalist, 'TOJSON_ARGS') <- list(dataframe = "rows")


  # create widget
htmlwidgets::createWidget(
  name = 'sip',
  datalist,
  width = "100%",
  height = height,
  package = 'activeseqIplot',
  #elementId = NULL
)

}


#' Shiny bindings for sip
#'
#' Output and render functions for using sip within Shiny
#' applications and interactive Rmd documents.
#'
#' @param outputId output variable to read from
#' @param width,height Must be a valid CSS unit (like \code{'100\%'},
#'   \code{'400px'}, \code{'auto'}) or a number, which will be coerced to a
#'   string and have \code{'px'} appended.
#' @param expr An expression that generates a sip
#' @param env The environment in which to evaluate \code{expr}.
#' @param quoted Is \code{expr} a quoted expression (with \code{quote()})? This
#'   is useful if you want to save an expression in a variable.
#'
#' @name sip-shiny
#'
#' @export
sipOutput <- function(outputId, width = '100%', height = '400px'){
htmlwidgets::shinyWidgetOutput(outputId, 'sip', width, height, package = 'sip')
}

#' @rdname sip-shiny
#' @export
renderSip <- function(expr, env = parent.frame(), quoted = FALSE) {
if (!quoted) { expr <- substitute(expr) } # force quoted
htmlwidgets::shinyRenderWidget(expr, sipOutput, env, quoted = TRUE)
}
