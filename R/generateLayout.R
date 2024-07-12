#' Generates the layout for the plot of a sequence object
#'
#' @param seqObj the sequence object
#' @return data.frame object
#' @export




generateLayout <- function(seqObj){
  names <- attr(seqObj, which ="names")
  alphabet <- attr(seqObj, which ="alphabet")
  void <- attr(seqObj, which ="void")
  nr <- attr(seqObj, which ="nr")
  ##todo: add condition to check if weights exist
  
  weights <- rep(1, nrow(seqObj) ) 
  
  seqObj$weights <- weights
  ## empty data frame with 
  
  
  ##only count those with 
  dummy <- data.frame(n = numeric(), value = character(), name = character() ) 
  ##loop over all time points
  for(var in names){
    ## count for each var all values
    t <- dplyr::count(seqObj, !!rlang::sym(var) , wt = weights) 
    
    ## generate a tibble data frame as blue print
    k <- tibble::as_tibble( c(alphabet))
    ## set n to 0 
    k$n <- 0
    k$name = var
    
    ## transform t to long format
    up <- tidyr::pivot_longer(t, !!rlang::sym(var))
    
    #value n name (key)
    k <- dplyr::rows_upsert(k, up,  by =c("value"))
    
    dummy <- dplyr::add_row(dummy, k)
  }
  dummy <- dplyr::filter(dummy, value %in% alphabet)
  
  
  stack <- dplyr::group_by(dummy, name) 
  
  stack <- dplyr::mutate(stack, cum_n = cumsum(n))
  
  stack <- dplyr::mutate(stack, lowerBound = tidyr::replace_na(lag(cum_n),0) )
  ## range
  stacky <- dplyr::group_by(dummy, value) 
  stacky <- dplyr::summarize(stacky, max = max(n))
  stacky <- dplyr::ungroup(stacky)
  
  ##stacky needs to be sumed up and serves for the layout
  stacky <- dplyr::mutate(stacky, upperBound = cumsum(max))

  ##calculating lower bound bound
  
  stacky <- dplyr::mutate(stacky, lowerBound = tidyr::replace_na(dplyr::lag(upperBound),0) )
  stacky <- dplyr::rename(stacky, state= value)

}













