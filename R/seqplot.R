## ====================================================
## Generic function for plotting state sequence objects
## ====================================================

#### code copied from TramineR and adjusted only###

seqplot <- function(seqdata, group = NULL, type ="i", main = NULL, cpal = NULL, missing.color = NULL, ylab=NULL, yaxis = TRUE,
                    axes = "all", xtlab = NULL, cex.axis = 1, with.legend = "auto", ltext = NULL, cex.legend = 1, use.layout = (!is.null(group) | with.legend != FALSE), legend.prop = NA,
                    rows = NA, cols = NA, tooltip = list(), width = NULL, height = NULL, barWidth = NULL, barHeight = NULL, margins = NULL,  xlabel = NULL, title, cex.plot, withlegend,
                    paddingInnerX = 0, paddingInnerY = 0, sliderX = list( visible = FALSE, range = c(0,1)), sortv= NULL, fisheye = NULL, ...){



  if (!inherits(seqdata,"stslist"))
    stop(call.=FALSE, "seqplot: data is not a state sequence object, use seqdef function to create one")

  oolist <- list(...)

  if ("sortv" %in% names(oolist)) {sortv <- oolist[["sortv"]]


  }

  if(typeof(sortv) == 'character'){

    sortv <- list(var=sortv, nodropdown = TRUE)
  }

  leg.ncol <- if ("ncol" %in% names(oolist)) { oolist[["ncol"]] } else { NULL }
  oolist <- oolist[names(oolist) != "ncol"]




  ##========
  ##Plotting
  ##========

  olist <- oolist


  ## ToDo: ordentliches Interfaces welches checkt, ob die Werte nicht schon defined sind
  ## extracting information from state sequence object
  names <- attr(seqdata, "names")
  row.names <- attr(seqdata, "row.names")
  start <- attr(seqdata, "start")
  missing <- attr(seqdata, "missing")
  nr <- attr(seqdata, "nr")
  alphabet <- attr(seqdata, "alphabet")
  class <- attr(seqdata, "class")
  labels <- attr(seqdata, "labels")
  weights <- attr(seqdata, "weights")
  cpal <- attr(seqdata, "cpal")
  missing.color <- attr(seqdata, "missing.color")
  xlabel <- xlabel
  sliderX <- sliderX
  xtstep <- attr(seqdata, "xtstep")
  tick.last <- attr(seqdata, "tick.last")
  if (!is.null(barWidth)) { width <- NULL}
  if (!is.null(barHeight)) {height <- NULL}
  if (is.null(barWidth) & is.null(width) ){ barWidth <- 60 }
  if (is.null(barHeight) & is.null(height) ){ barHeight <- 1 }

  plist <- list(names = names, row.names = row.names, xtstep = xtstep, cpal=cpal, missing.color=missing.color,
                 yaxis=yaxis, xtlab=xtlab, labels = labels, alphabet = alphabet,
                 barWidth = barWidth, barHeight = barHeight, xlabel = xlabel, group = levels(group),
                 margins = margins, paddingInnerX = paddingInnerX, paddingInnerY = paddingInnerY, sliderX = sliderX, tooltip = tooltip, sortv = sortv, fisheye=fisheye )



  ## ==============================
  ## Preparing if group is not null
  ## ==============================

	## ==============================
	## Preparing if group is not null
	## ==============================

	if (!is.null(group)) {
          group <- group(group)

          ## Check length
          if (length(group)!=nrow(seqdata))
            stop(call.=FALSE, "group must contain one value for each row in the sequence object")

          nplot <- length(levels(group))
          gindex <- vector("list",nplot)

          if (length(ylab) <= 1) ## length(NULL) is 0
            ylab <- rep(ylab, nplot)
          else if (length(ylab) != nplot)
            msg.stop("If a vector, ylab must have one value per group level!")

          if (type=="mt" & !is.null(barlab)){
            if (!(ncol(barlab) %in% c(1,nplot)) )
            stop(call.=FALSE, "When a matrix, bar.labels should have one column per group")
          }

          for (s in 1:nplot)
            gindex[[s]] <- which(group==levels(group)[s])

          ## Title of each plot
          #if (!is.null(main))
          #  main <- paste(main,"-",levels(group))
          #else
          #  main <- levels(group)


          if (!is.null(main)) {
              if (main[1] == "auto")
                main <- levels(group) ## will be NULL if group is NULL
              else if (length(main)==1)
                main <- paste(main,"-",levels(group))
          }

	} else { # single group
          nplot <- 1
          gindex <- vector("list",1)
          gindex[[1]] <- 1:nrow(seqdata)
	}


  ## Sequence index plot
  if (type=="i" || type=="I") {
    f <- function(seqdata) {return(seqdata)}
    with.missing <- TRUE

    ## Selecting sub sample for sort variable
    ## according to 'group'

    if ("sortv" %in% names(olist)) {
      if (!length(sortv)==1) {
        olist[["sortv"]] <- sortv[gindex[[np]]]
      }
    }

    if (type=="I") {
      if (!"idxs" %in% names(olist)) {olist <- c(olist, list(idxs=0))}
      if (!"space" %in% names(olist)) {olist <- c(olist, list(space=0))}
      if (!"border" %in% names(olist)) {olist <- c(olist, list(border=NA))}
    }
  }  else
    stop("Unknown 'type' argument.")

  ## Calling appropriate function and plotting

  flist <- names(formals(f))
  if ("with.missing" %in% names(olist)) {
    with.missing <- olist[["with.missing"]]
  } else if ("with.missing" %in% flist) {
    with.missing <- formals(f)$with.missing
  }

  ## Xlim when plotting individual sequences
  ##! Xlim = zeitspanne
  if (type %in% c("i", "I", "f")) {
    if (!"xlim" %in% names(olist)) {
      olist <- c(olist, list(xlim=c(0, ncol(seqdata))))
    }
  }

  match.args <- names(olist) %in% flist
  fargs <- olist[match.args]
  fargs <- c(list(seqdata=seqdata), fargs)
  #msg(paste("do.call(",f, fargs,")"))
  res <- do.call(f, args=fargs)

  olist <- olist[!match.args]
  ## suppress non plot arguments if necessary
  olist <- olist[!names(olist) %in% c("with.missing")]
  if (!(type %in% c("i","I","rf"))) olist <- olist[!(names(olist) %in% c("sortv","weighted"))]
  ## nimm die liste von den parametern (hier list(age ...) als user defined sache, binde sie zusammen zu einem neuen

  ## datensatz welcher so die variable auf jedem eintrag enthält (gilt auch für select/highlight funktionen bei den vorher mit den
  ## entsprechenden conditions die variablen als binär erstellt werden müssen z.b condition1 = true/false))


  ## das test -object wird dann übergeben an die js sache und oben in der plist ersetzt es das x
  #test <- cbind(do.call("cbind", list(age = data$age, pid = data$pid, group = group )), res)
  test <- cbind(do.call("cbind", res))
  nlist <- list(test, plist)


  attr(nlist, 'TOJSON_ARGS') <- list(dataframe = "rows")



    # create widget
 htmlwidgets::createWidget(
    name = 'sip',
    nlist,
    width = "100%",
    height = height,
    package = 'activeseqIplot',
    #elementId = NULL
  )

}


seqplot_sliderX <- function(asip, title="") {

  #asip$x$sliderX <- list(visible = TRUE)
  #message(asip)
  return(asip)

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
