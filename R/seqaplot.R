#' Create a new sequence active plot
#'
#' \code{seqaplot()} initializes the sequence active plot html widget.
#' By default, it returns a static plot that can be enhanced with adding interactive functions.
#'
#' @param seqdata a state sequence object or a \code{list(seqdata.A, seqdata.B, ...)} containing several state sequence objects. Each SSO is plotted separatly, yet they are keyed by id which defaults to your SSO's \code{row.name}. Hence, a highlighted selection in one plot is also highlighted in the other plots. This is useful whenever the SSOs are inherently linked. For example, in combination with \code{sortv} to display different distance algorithms solutions on the same SSO. Or, when comparing different SSOs over multiple channels of the same person.
#' @param legend If true, the legend is rendered on top of the plot.
#' @param flexwrap The flewrap property sets whether the plots are forced onto one line or can wrap onto multiple lines. If set to \code{nowrap}, plots are forced onto one line. Default is \code{wrap}.
#' @param tooltip If true, displays a tooltip indicating the state and id of the selected rectangle. If you want to display further information pass in a list where each entry consists of yet another list in the following format: \code{list( var=VAR, label="YOURLABEL") }. For example, to additionally display information about language and birthyear define the following: \code{tooltip = list(list( var=biofam$plingu02, label="language"),list(var=biofam$birthyr, label="birthyear"))}.
#' @param barWidth determines the width of a single rectangle representing one state. The overall width of the plot is calculated by \code{barWidth * numberOfStates}.
#' @param barHeight determines the height of a single rectangle representing one state. The overall width of the plot is calculated by \code{barWidth * numberOfStates}.
#' @param margins determines the plot's margin, starting with "top" and going clockwise: \code{c(top, right, bottom, left)}. Defaults to \code{c(20,20,20,20)}.
#' @param paddingInnerX determines the inner x (horizontal) padding between the rectangles.
#' @param paddingInnerY determines the inner y (vertical) padding between the rectangles.
#' @param sortv Re-sorts the index plot. Instead of sorting the plot according to some function, it merely remaps the order of the keyed sequences. Each sequence is keyed by the SSO's \code{row.names}. Re-ordering the plot requires to 1) create a re-ordered version of \code{row.names} and 2) pass this in a list with the following format: \code{list(var=SORTED_VAR,label="YOUR_LABEL")}. See the example section for more details.
#' @param fisheye Enables a fisheye function which will increase the hight of the selected sequence. Be careful! Can be computationally expensive. If set to \code{TRUE} it defaults to \code{list(d=10, a = 300, boundaries=200)} where \code{d} stands for the sized the selected sequence is increased to, and \code{boundaries} stands for the range the fisheye effect is applied to.
#' @param highlight Highlights a specific selection by graying out non-selected sequences. It works with boolean masking, graying out the sequences set to \code{FALSE}. Accepts a list where each entry is yet another list in the following format: \code{list(var=VAR,label="YOUR LABEL")}. See the example section for further reference.
#' @return seqaplot object
#' @export
#' @examples \dontrun{
#' ##creating two plots of the same data set
#' seqaplot(list(biofam.seq,biofam.seq))
#' ##including a tooltip with custom information
#' ##creating multiple sort dropdowns
#' ###creating the sorted variable first
#' sort_year <- row.names(biofam)[order(biofam$birthyr, decreasing=TRUE)]
#' sort_lang <- row.names(biofam)[order(biofam$plingu02, decreasing=TRUE)]
#' ### passing it on to the sequence active plot
#' seqaplot(biofam.seq, sortv = list( list( var=sort_year, label="Sort by year" ), list( var=sort_lang, label="Sort by Language" )))
#' ## creating a highlight dropdown
#' ### creating a var containing TRUE/FALSE values (boolean masking)
#' protestants <- biofam$p02r01 == "Protestant or Reformed Church"
#' ### passing it on to the sequence active plot
#' seqaplot(biofam.seq, highlight = list( list( var=protestant, label="Highlight if protestant" ))
#' }

## ====================================================
## Generic function for plotting state sequence objects
## ====================================================

#### code copied from TramineR and adjusted only###

seqaplot <- function(seqdata, group = NULL, type ="i", main = NULL, cpal = NULL, missing.color = NULL, ylab=NULL, yaxis = TRUE,
                  axes = "all", xtlab = NULL, ltext = NULL, legend = NULL, legend.prop = NA, flexwrap = "wrap",
                  rows = NA, cols = NA, tooltip = NULL, width = "100%", height = NULL, barWidth = 20, barHeight = 2, margins = c(20,20,20,20),  xlabel = NULL, title, cex.plot, withlegend,
                  paddingInnerX = 0.01, paddingInnerY = 0,  sortv= NULL, fisheye = NULL, marks = NULL, highlight = NULL, ...){


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
    if(isTRUE(fisheye)){
      fisheye = list(d=10, a = 300, boundaries=200)

    }

    if(isTRUE(tooltip)){
      tooltip = list()
    }


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
