HTMLWidgets.widget({
  name: 'sip',
  type: 'output',

  factory: function(el, width ,height) {

    // TODO: define shared variables for this instance

    let chart;


    return {

      renderValue: function(input) {
        // TODO: code to render the widget, e.g.
      //prepare data to normal format
      const config = input[0][1]

      let data = input.map( d =>  Object.assign(d[0], d[1]))
       chart = drawChart()
       let chartContainer = d3.select(el)
        .append("div")
          .style("display", "flex")
          .style("flex-wrap", config.flexwrap)
          .style("flex-shrink", "0")
          .selectAll("div")
          .data(data)
          .join("div")
            .attr("class","container")
            .style("min-width", config.width)
            .style("display","block")
            .style("float","left")
            .style("position", "relative")
            .style("background-color","white")


      chartContainer.call(chart)
      if(config.fisheye && config.fisheye != [] )
        chart.fisheye(config.fisheye)

      if(config.sortv && config.sortv != [] )
        chart.sortv(config.sortv)


      if(config.tooltip && config.tooltip != [] )
          chart.tooltip(config.tooltip)

      if(config.highlight && config.highlight != [] )
          chart.highlight(config.highlight)
      if(config.legend)
          chart.legend(config.legend)

        return chart
      }



    };
  }
});


 function drawChart(){

        let updateY = [];
        let highlightY = [];
        let createTooltip = [];
        let createLegend = []
        let legend;
        let tooltip;

        let sort;
        let sortv;
        let highlight;
        let createDropdown = [];
        let createDropdownHighlight = [];

        let tltip;
        let fisheye;
        let canvas;
        let d= 120,
        a = 0,
        boundaries = 100;
        let enableFisheye=[];
        let mouseMove = [];
        let selectedIds = [];
        let selected = [];
        let markers = []
        //integrate some sort of if condition that
        // 1) returns a legend and an emptiy container grid
        // 2) returns the svg for each cluster
        function chart (selection) {

            selection.each(function(data,i){

              const fisheyeMove = function(d) {
                const yCoord =d3.pointer(d, this)[1];
                const yFish = fisheye_scale(yCoord);

                seq.attr("transform", (d,i) => `translate(0,  ${yFish(y(d.id)).y})`)
                seq.selectAll("rect").attr("height", function(d){return yFish(y(this.parentNode.__data__.id)).height
              })
              }

              const fisheyeOut = function(d) {
                seq.selectAll("rect").attr("height", barHeight)
                seq.attr("transform", (d,i) => `translate(0,  ${y(d.id)} ) `)
              }
              const colorScale = d3.scaleOrdinal()
                                .domain( data.alphabet)
                                .range(data.cpal)
                                .unknown(data["missing.color"]);
              const rownames =  data["row.names"]

              const xLabel = (data.xlabel || data.names)
              const [marginsTop, marginsRight, marginsBottom, marginsLeft] = data.margins

              const barHeight = data.barHeight;
              const barWidth =  data.barWidth;
              const height = barHeight * data.length + marginsBottom + marginsTop
              const width = barWidth * (data.names.length)  + marginsLeft + marginsRight
              //declaring scale functions
              const y = d3.scaleBand()
                          .paddingInner(data.paddingInnerY)
                          .domain(rownames)
                          .range([0, barHeight * (data.length)])

              const x = d3.scaleBand()
                          .domain( [...Array(data.names.length).keys()])
                          .range([ 0, width - marginsLeft - marginsRight ])
                          .paddingInner(data.paddingInnerX)
              //declaring tool tip function

              const container = d3.select(this)

              const xAxis = g => g
                    .attr("transform", `translate(${marginsLeft}, ${marginsTop - 3})`)
                    .call(d3.axisTop(x)
                              .tickFormat((d,i) =>   xLabel[i])
                          )
                    .call(g => g.select(".domain").remove())

              const svg = container
                    .append("svg")
                    .attr("viewBox", [0, 0, width, height ]);

              svg.append("style")
                    .text(`g.hidden > rect { fill: #000; fill-opacity: 0.4;}
                    g.gray > rect {filter: grayscale(1)}
                    line.hidden{opacity:0;}
                    line.show {opacity:1;}
                    g.hidden > line {opacity:1;}`);


              const xAx = svg.append("g")
                            xAx.call(xAxis)

              const canvas = svg.append("g")
                          .attr("transform", `translate(${marginsLeft}, ${marginsTop})` )

              const seq =  canvas.selectAll("g")
                            .data(data.map( (d,i) => Object.assign(Object.values(d), {id :rownames[i], index: i})) , (d,i) => rownames[i])
                            .join("g")
                                .attr("transform", (d,i) => `translate(0,  ${d.y=y(d.id)}) `)

              const marks = seq
                            .append("line")
                              .attr("x1", -12)
                              .attr("x2", -3)
                              .attr("y1",0)
                              .attr("y2",0)
                              .attr("stroke","#888")
                              .classed("hidden",true)
                              .classed("show", d => markers.includes(d.id))

              const paths = seq.selectAll("rect")
                                .data( (d,i) => d)
                                .join("rect")
                                  .attr("width", x.bandwidth())
                                  .attr("height", y.bandwidth())
                                  .style("fill", d => colorScale(d))
                                  .attr("x", (d,i) =>  x(i))
                                  .attr("y", 0)

              const range = d3.extent(y.range());
              const step = y.step();
              const fisheye_scale = function(a) {
                const min = (a - fisheye.boundaries) < range[0] ?  range[0] : (a - fisheye.boundaries),
                      max = (a + fisheye.boundaries) > range[1] ?  range[1] : (a + fisheye.boundaries);

                function get_y(_){
                  const x =  _,
                      left = x < a,
                        m = left ? a - min : max - a;
                  if (!(x > min && x < max))  return x
                  if (m == 0) m = max - min;
                  const y = (left ? -1 : 1) * m * (fisheye.d + 1) / (fisheye.d + (m / Math.abs(x - a))) + a
                  return (x > min && x < max) ? y :x
                }


                function fisheye_function(_) {

                  const x = _;
                  const y1 = get_y(x)
                  const y2 = get_y(x + step)
                  return {y : y1   , height : y2-y1};
                }

                return fisheye_function
              };
              highlightY = highlightY.concat(function(){
                seq.classed("gray", (d,i) => !highlight[i] )

              })
              updateY = updateY.concat(function() {
                const sortedY = y;
                sortedY.domain(sort);
                  const t = svg.transition()
                    .duration(750);
                  seq.transition(t)
                    .delay((d,z ) => z * 2)
                    .attrTween("transform", function(d,j)  {
                        const x = d3.interpolateNumber(d.y, sortedY(d.id));
                      return t =>  `translate(${0},  ${d.y=x(t)})`;}
                    );


                });

              createLegend = createLegend.concat(function(){
                const legend = container
                .insert("div","svg")
                  .style("display","flex")
                  .style("flex-flow","row wrap")
                  .style("flex-grow",1)
                  .style("justify-content","center")
                  .style("align-content","space-between")
                  .style("gap","10px")
                  .attr("class","legend")

                const legendEnries =  legend.selectAll("div")
                              .data(d3.zip(colorScale.range(), colorScale.domain()))
                                .join("div")
                                .style("display","flex")
                                .style("gap","10px")



                legendEnries.append("div")
                                  .style("width", "15px")
                                  .style("height", "15px")
                                  .style("background-color", d => d[0])

                legendEnries.append("div")
                                  .text(d => d[1])

              })
              createTooltip = createTooltip.concat(function(){


                 mouseMove = mouseMove.concat( function () {
                 seq.classed("hidden", d => d.id == this.parentNode.__data__.id )})

                const tooltipMove = function(d){

                  const {left, right,top} = this.getBoundingClientRect();
                  const {left: parentLeft, top : parentTop} = this.parentNode.parentNode.parentNode.getBoundingClientRect()
                  tltip.style("left", `${right - parentLeft}px`)
                    .style("top", `${top -parentTop}px`)
                    .style("opacity", 1)
                    .style("box-sizing","border-box")


                  let baseInfo =   `state: ${this.__data__}, id: ${this.parentNode.__data__.id}`

                  let customInfo = "";
                  if (tooltip) customInfo = tooltip.map(d => `, ${d.label}: ${d.var[this.parentNode.__data__.index]}`).join("")
                  tltipText.html(`${baseInfo}${customInfo}`)
                  }

                const tooltipOut = function(){
                  tltip.style("opacity",0)
                }

                const tltip = container
                .append("div")
                  .style("position", "absolute")

                const tltipText = tltip
                .append("div")
                  .html("index: , state: ")
                  .style("color","#e3e3e3")
                  .style("background-color", "#333")
                  .style("max-width", "250px")
                  .style("border-radius", "4px")
                  .style("padding","3px 2px")
                  .style("text-align", "center")
                  .style("position","relative")
                  .style("box-sizing","border-box")

                paths.on("mousemove", function(e){  tooltipMove.bind(this)(e); mouseMove.map( d =>  { d.bind(this)(e)} )})
                  paths.on("mouseout", tooltipOut)
                })

              createDropdown = createDropdown.concat(function(){
                const dropdown = container
                  .insert("div", legend ? ".legend":"svg")
                    .attr("height", "20px")
                    .attr("width","30px")

                dropdown.append("label")
                  .html("Sort according to: ")


                dropdown
                    .append("select")
                    .on("change", e => {sort = e.target.selectedOptions[0].__data__.var; updateY[i]()})
                    .selectAll("option")
                    .data(sortv)
                      .join("option")
                      .html(d => d.label)

              })

              createDropdownHighlight = createDropdownHighlight.concat(function(){
                const dropdown = container
                  .insert("div",".legend")
                    .attr("height", "20px")
                    .attr("width","30px")

                dropdown.append("label")
                  .html("Hightlight according to: ")


                dropdown
                    .append("select")
                    .on("change", e => {highlight = e.target.selectedOptions[0].__data__.var; highlightY[i]()})
                    .selectAll("option")
                    .data(highlight)
                      .join("option")
                      .html(d => d.label)

              })

              enableFisheye = enableFisheye.concat(function(){
                canvas.on("mouseleave", fisheyeOut)
                       .on("mousemove",  fisheyeMove)
                })

            });
        }

        chart.data = function(value) {
                if (!arguments.length) return data;
                    data = value;
                return chart;
        };

        chart.legend = function(value) {
          if (!arguments.length || value === null) return legend;
              legend = value;
          for(let i in createLegend){
            if (typeof createLegend[i] === 'function') createLegend[i]();
            }
          return chart;
        };

        //set tooltip -> müsste ne true/false bedingung sein
        chart.tooltip = function(value) {
          if (!arguments.length) return tooltip;
              tooltip = value;
          for(let i in createTooltip){
          if (typeof createTooltip[i] === 'function') createTooltip[i]();
          }
          return chart;
        };

        chart.mark = function(value){

          if (!arguments.length || value === null) return markers;
          markers = value;
          return chart;
        }

        chart.fisheye = function(value){

          if (!arguments.length || value === null) return fisheye;
          fisheye = value;
          for(let i in enableFisheye){
            if (typeof enableFisheye[i] === 'function') enableFisheye[i]();
          }
          return chart;
        }
        chart.sortv = function(value) {

              if (typeof value === 'object' && value.nodropdown ){
                sort = value.var;
              }
              else if(typeof value == 'object' && !value.nodropdown && !Array.isArray(value)){
                sortv = [value]; sort = value.var;
              }else {
                sortv = value; sort = value[0].var}

              for(let i in createDropdown){
                  if (typeof createDropdown[i] === 'function') createDropdown[i]();
                }
              for(let i in updateY){
                if (typeof updateY[i] === 'function') updateY[i]()
              }
          return chart;
        };

        chart.highlight = function(value) {
          if(typeof value == 'object' && !value.nodropdown && !Array.isArray(value)){
            highlight = [value];
          }else {
            highlight = value;}

          for(let i in createDropdownHighlight){
              if (typeof createDropdownHighlight[i] === 'function') createDropdownHighlight[i]();
            }

      return chart;
    };

        return chart;

}
