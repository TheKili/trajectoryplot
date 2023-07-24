devtools::load_all()

library("TraMineR")
library("jsonlite")
library("magrittr")
fromJSON('{"left":20}')

data(biofam)


biofam.seq <- seqdef(biofam, var = c(10:25))
biofam$plingu02

sort_year <- row.names(biofam)[order(biofam$birthyr, decreasing=TRUE)]
sort_lang <- row.names(biofam)[order(biofam$plingu02, decreasing=TRUE)]

#fisheye = list(d=10, a = 300, boundaries=200)
devtools::load_all()
activeseqIplot::seqiplot(biofam.seq, margins = c(20,20,20,20), barWidth = 40, barHeight = 2, paddingInnerX = 0.01, tooltip = list(list( var=biofam$plingu02, label="Language"),list(var=biofam$birthyr, label="birthyear")), sortv = list(list(var=sort_lang,label="Sort by Language"), list(var=sort_year,label="Sort by year")))
activeseqIplot::seqiplot(biofam.seq, margins = c(20,20,20,20), barWidth = 40, barHeight = 2, paddingInnerX = 0.01, tooltip = list(list( var=biofam$plingu02, label="language"),list(var=biofam$birthyr, label="birthyear")), sortv = list(var=sort_lang,label="Sort by language") )
activeseqIplot::seqiplot(biofam.seq, margins = c(20,20,20,20), barWidth = 40, barHeight = 2, paddingInnerX = 0.01, tooltip = list(list( var=biofam$plingu02, label="language"),list(var=biofam$birthyr, label="birthyear")), fisheye = list(d=10, a = 300, boundaries=200))


TraMineR::seqiplot(biofam.seq)
attributes(t)

htmlwidgets::onRender(t, "
    function(el, x) {
      this.test(x)
    }
  " ,list(list( var=biofam$plingu02, label="language"),list(var=biofam$sex, label="sss")) )
names(biofam)



