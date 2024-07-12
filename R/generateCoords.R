library("data.table")

#' Generates the coordinates for the plot of a sequence object based on a precomputed layout
#'
#' @param seqObj the sequence object
#' @param layout layout computed with generateLayout()
#' @return data.table object
#' @export

generateCoords <-  function(seqObj,layout ){
  
  #createList <- Vectorize(function(time, wideLower, wideUpper, wideCenter,  state=NULL) list(time= time, wideLower =wideLower, wideUpper = wideUpper, wideCenter = wideCenter ), SIMPLIFY = FALSE)
  
  names <- attr(seqObj, which= "names")
  alphabet <- attr(seqObj, which= "alphabet")
  labels <- attr(seqObj, which= "labels")
  
  dt <- data.table::data.table(seqObj)
  weights <-attr(seqObj, which= "weights")
  if(is.null(weights)) weights <- rep(1, nrow(seqObj) )
  
  dt$weight <-  weights
  
  ##integrate the sum stuff
  ##todo: write if condition for computation of alignment 
  #   for (col in names){
  #     dt[, c(paste(col, "l", sep=""), paste(col, "u", sep=""), paste(col, "c", sep="")) := list(
  #       cumsum(weight) +  layout$lowerBound[match(get(col), layout$state)]  -1,
  #       cumsum(weight) +  layout$upperBound[match(get(col), layout$state)] - sum(weight) -1,
  #       layout$lowerBound[match(get(col), layout$state)] + cumsum(weight) +  (layout$upperBound[match(get(col), layout$state)]  - layout$lowerBound[match(get(col), layout$state)] - sum(weight)) * 0.5 -1)
  #       ,  by = get(col)]
  #     dt[, c(col) := createList(col, get(paste0(col,'l') ), get(paste0(col,'u') ), get(paste0(col,'c') ))]
  # }
  
  ## interface for alignment
  
  
    for (col in names){
      dt <- data.table::data.table(dt)
      dt[, paste(col, "l", sep="") := 
        cumsum(weight) +  layout$lowerBound[match(get(col), layout$state)]  -1,
        by = get(col)]
      dt[, c(col) := get(paste0(col,'l') )]
      dt[, paste0(col,'l') := NULL]
    }  
  
  
  
  attr(dt, which ="alphabet") <- alphabet
  attr(dt, which ="labels") <- labels
  dt[, -c("weight")]

  }