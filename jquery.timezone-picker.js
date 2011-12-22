(function($) {
  var _boundingBoxes;
  var _map;
  var _options;
  var _mapZones = {};

  var clearZones = function() {
    $.each(_mapZones, function(i, zone) {
      $.each(zone, function(j, polygon) {
        polygon.setMap(null);
      });
    });

    _mapZones = {};
  };

  var drawZone = function(name) {
    if (_mapZones[name]) {
      return;
    }

    $.get(_options.jsonRootUrl + 'polygons/' + name + '.json', function(data) {
      data = JSON.parse(data);

      _mapZones[name] = [];
      $.each(data.polygons, function(i, polygon) {
        var coords = [];
        $.each(polygon.points, function(j, point) {
          coords.push(new google.maps.LatLng(point.y, point.x));
        });

        var mapPolygon = new google.maps.Polygon({
          paths: coords,
          strokeColor: '#ff0000',
          strokeOpacity: 0.7,
          strokeWeight: 1,
          fillColor: '#ffcccc',
          fillOpacity: 0.5
        });
        mapPolygon.setMap(_map);

        google.maps.event.addListener(mapPolygon, 'click', function() {
          if (_map.lastInfoWindow) {
            _map.lastInfoWindow.close();
          }

          // TODO: Add more information to this bubble
          var id = data.name.toLowerCase().replace(
            /[^a-z0-9]/g, '_');
          var infowindow = new google.maps.InfoWindow({
            content: '<div id="' + id + '"><center>' +
              '<h1>' + data.name + '</h1>' +
              '<button>Use Timezone</button><button>Cancel</button>' +
              '</center></div>',
            maxWidth: 500
          });

          google.maps.event.addListener(infowindow, 'domready', function() {
            $('#' + id + ' button:eq(0)').click(function(e) {
              if (e.which > 1) {
                return;
              }

              if (_options.onSelected) {
                _options.onSelected(data.name);
              }

              e.preventDefault();
              return false;
            });

            $('#' + id + ' button:eq(1)').click(function(e) {
              if (e.which > 1) {
                return;
              }
              infowindow.close();
              e.preventDefault();
              return false;
            });
          });
          infowindow.setPosition(new google.maps.LatLng(
            polygon.centroid[1],
            polygon.centroid[0]
          ));
          infowindow.open(_map);

          _map.lastInfoWindow = infowindow;
        });

        _mapZones[name].push(mapPolygon);
      });
    });
  };

  var methods = {
    init: function(options) {
      // Populate the options and set defaults
      _options = options || {};
      _options.initialZoom = _options.initialZoom || 2;
      _options.initialLat = _options.initialLat || 0;
      _options.initialLng = _options.initialLng || 0;
      _options.strokeColor = _options.strokeColor || '#ff0000';
      _options.strokeWeight = _options.strokeWeight || 2;
      _options.strokeOpacity = _options.strokeOpacity || 0.7;
      _options.fillColor = _options.fillColor || '#ffcccc';
      _options.fillOpacity = _options.fillOpacity || 0.5;
      _options.jsonRootUrl = _options.jsonRootUrl || '/tz_json/';

      // Create the maps instance
      _map = new google.maps.Map(this.get(0), {
        zoom: _options.initialZoom,
        mapTypeId: google.maps.MapTypeId.ROADMAP,
        center: new google.maps.LatLng(_options.initialLat, _options.initialLng)
      });

      $.get(_options.jsonRootUrl + 'bounding_boxes.json', function(data) {
        boundingBoxes = JSON.parse(data);
      });

      google.maps.event.addListener(_map, 'click', function(e) {
        var lat = e.latLng.Qa;
        var lng = e.latLng.Ra;

        var candidates = [];
        $.each(boundingBoxes, function(i, v) {
          var bb = v.boundingBox;
          if (lat > bb.ymin && lat < bb.ymax && lng > bb.xmin && lng < bb.xmax) {
            candidates.push(v.name.toLowerCase().replace(/[^a-z0-9]/g, '-'));
          }
        });

        if (_map.lastInfoWindow) {
          _map.lastInfoWindow.close();
        }

        clearZones();
        $.each(candidates, function(i, v) {
          drawZone(v);
        });
      });
     }
  };

  $.fn.timezonePicker = function(method) {
    if (methods[method]) {
      return methods[method].apply(this, Array.prototype.slice.call(arguments, 1));
    }
    else if (typeof(method === 'object') || !method) {
      return methods.init.apply(this, arguments);
    }
    else {
      $.error('Method ' + method + ' does not exist on jQuery.timezonePicker.');
    }
  };

})(jQuery);
