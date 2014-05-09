(function(){

  xtag.mixins['shadowdom'] = {
  	lifecycle: {
      compile: function(elemProto){
        var fn = elemProto.lifecycle.created || function(){};
        elemProto.lifecycle.created = function(){
          var shadow = this.createShadowRoot();
          if (elemProto.shadow){
            // TODO: allow more types of shadow content
            // (nodes, fragment, selectors?, string)
            shadow.innerHTML = elemProto.shadow;
          }
          fn.call(this);
        };
      }
  	}
  };

})();
