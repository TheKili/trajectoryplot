#' Create a new sequence active plot
#'
#' \code{seqaplot()} initializes the sequence active plot html widget.
#' By default, it returns a static plot that can be enhanced with adding interactive functions.
#'
#' @param seqdata a state sequence object or a \code{generateCoords(seqobj)} generated coordinates with a passed layout (see layout).
#' @param layout A layout that provides the plot layout. Can be used to 1) draw a global layout where 2) local sequences (e.g. by group) are drawn.
#' @param names column names of the sequence object
#' @param ylab Labels for states
#' @param strokeStyle global stroke style. Any valid html color specification is valid. user rgba() for transparency e.g. \code{color="rgba(255,0,0,0.5)"}
#' @param group Varialbe whos factor levels are used for coloring the plot. Requieres a list of groupColors. 
#' @param groupColor List of html color specification to color factor levels of group. 

#' @param margins determines the plot's margin, starting with "top" and going clockwise: \code{c(top, right, bottom, left)}. Defaults to \code{c(20,20,20,20)}.
#' @return trajectoryplot object

## ====================================================
## Generic function for plotting state sequence objects
## ====================================================

#### interface copied from TramineR for consistency ###

trajectoryplot <- function(seqdata, alphabet = NULL, names = NULL, layout = NULL, ylab=NULL, yaxis = TRUE,
                  strokeStyle = 'rgb(255,0,0,0.1)',groupColor = NULL,  group = NULL, area = NULL,
                  width = "100%", height = 1000, margins = c(20,20,20,20), padding = list(top = 10, bottom= 10, left = 50, right = 10) ,innerPadding = c(0,0,0,0),  xlabel = NULL, position = "center", alpha =NULL, ...){

  
  
  


## seqdata: as soon as layout and coords is passed in only get attributes from seqobj
## check if ...
  

if(inherits(seqdata, what = "data.frame") | inherits(seqdata, what = "stslist") | inherits(seqdata, what = "data.table")) seqdata <- list(seqdata)

if(inherits(area, what = "data.frame") | inherits(area, what = "stslist") | inherits(area, what = "data.table")) area <- list(area)

  
oolist <- list(...)


##========
##Plotting
##========

olist <- oolist
groupColorList <- NULL

## ToDo: ordentliches Interfaces welches checkt, ob die Werte nicht schon defined sind
## extracting information from state sequence object
datalist <- list()
paramlist <-list()


## include index for group var
i  = 1
for (dataSet in seqdata){
  
    
    if ( inherits(dataSet, "stslist") ){
      layout <- generateLayout(dataSet)
      
      dataSet <- generateCoords(dataSet, layout = layout)
    }
  
    if(is.null(names)) names <- attr(dataSet, "names")
    row.names <- attr(dataSet, "row.names")
    dataArea <- area[[i]]
    start <- attr(dataSet, "start")
    missing <- attr(dataSet, "missing")
    nr <- attr(dataSet, "nr")
    class <- attr(dataSet, "class")
    if(is.null(ylab)) ylab <- attr(dataSet, "labels")
    weights <- attr(dataSet, "weights")
    a <- alpha[[i]]
    if(is.null(cpal)) cpal <- attr(dataSet, "cpal")
    missing.color <- attr(dataSet, "missing.color")
        xtstep <- attr(dataSet, "xtstep")
    tick.last <- attr(dataSet, "tick.last")
    if(!is.null(group)) dataSet$group = group
    if(!is.null(groupColor)) groupColorList = list(unique(dataSet$group) , groupColor)
    plist <- list(names = names, layout = layout, ylab = ylab, yaxis = yaxis, padding = padding, width = width, height = height, margins = margins, xlabel = xlabel, position = position, 
    strokeStyle = strokeStyle, innerPadding = innerPadding, dataArea = dataArea, alpha = a)
    if(!is.null(groupColorList)) {
      plist$groupColorList <-  groupColorList
      plist$groupKey <- "group"
    }
      
    datalist[[length(datalist) + 1]] =list( cbind(dataSet), plist)
    i <- i +1
}




  attr(datalist, 'TOJSON_ARGS') <- list(dataframe = "rows",auto_unbox = TRUE)
#  attr(datalist, 'TOJSON_ARGS') <- list()

  # create widget
htmlwidgets::createWidget(
  datalist,
  name = 'trajectoryplot',
  width = width,
  height = height,
  package = 'trajectoryplot',
  #elementId = NULL
)

}


