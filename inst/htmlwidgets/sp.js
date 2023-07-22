test = function(el, width = 400, height = 800) {

    // TODO: define shared variables for this instance
    return {

      render: function() {
          
          test = drawGraph
            
            console.log(test().sort())
      }
  }
}  

test().render()

function drawGraph(){
        
        var updateY;
        
        function chart(selection) {
            
            console.log("chaart")
            update = "test";
            updateY = function(){
            
            
        }
        
        }
        
        
        chart.data = function(value) {
                console.log("daata" , value)
                    data = value;                    
                return chart;
        };
        
        chart.sort = function(value) {
                console.log("soort ", value)
                 console.log(updateY)           
                return chart;
        };
        
       return chart; 
}

