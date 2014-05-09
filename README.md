# About ShadowDOM Mixin


# Example

```
xtag.register('x-shady-foo', {
// 1. Add the mixin
  mixins: ['shadowdom'],
  lifecycle: {
    created: function(){
      var self = this;
      ['rise','repeat'].forEach(function(item){
        var li = document.createElement('li');
        li.textContent = item;
        self.appendChild(li);
      });
    }
  },
// 2.  define the shadow root
  shadow: '<h1>HI</h1><ul><content select="li"></content></ul>'
});

```

# Download it
```
bower install x-tag-mixin-shadowdom
```



# Links

[Yeoman X-Tag Generator](https://github.com/x-tag/x-tag-generator)

[X-Tags Docs](http://x-tags.org/docs)

[Guide for creating X-Tag Components](https://github.com/x-tag/core/wiki/Creating-X-Tag-Components)

[Using X-Tag components in your applications](https://github.com/x-tag/core/wiki/Using-our-Web-Components-in-Your-Application)


