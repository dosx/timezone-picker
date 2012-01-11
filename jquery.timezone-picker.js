(function($) {
  var _options;
  var _self;

  var _boundingBoxes;
  var _zoneCentroids = {};
  var _selectedRegionKey;
  var _selectedPolygon;
  var _map;
  var _mapZones = {};
  var _transitions = {};

  var _currentHoverRegion;
  var _hoverRegions = {};
  var _hoverPolygons = [];

  var _loader;
  var _loaderGif;
  var _maskPng;
  var _needsLoader = 0;

  var gmaps;

  // Forward declarations to satisfy jshint
  var hideLoader, hitTestAndConvert, onSelected, selectPolygonZone,
    showInfoWindow, slugifyName;

  var clearHover = function() {
    $.each(_hoverPolygons, function(i, p) {
      p.setMap(null);
    });

    _hoverPolygons = [];
  };

  var clearZones = function() {
    $.each(_mapZones, function(i, zone) {
      $.each(zone, function(j, polygon) {
        polygon.setMap(null);
      });
    });

    _mapZones = {};
  };

  var drawZone = function(name, lat, lng, callback) {
    if (_mapZones[name]) {
      return;
    }

    $.get(_options.jsonRootUrl + 'polygons/' + name + '.json', function(data) {
      _needsLoader--;
      if (_needsLoader === 0 && _loader) {
        hideLoader();
      }

      if (callback) {
        callback();
      }

      data = typeof data === 'string' ? JSON.parse(data) : data;

      _mapZones[name] = [];
      $.extend(_transitions, data.transitions);

      var result = hitTestAndConvert(data.polygons, lat, lng);

      if (result.inZone) {
        _selectedRegionKey = name;
        $.each(result.allPolygons, function(i, polygonInfo) {
          var mapPolygon = new gmaps.Polygon({
            paths: polygonInfo.coords,
            strokeColor: '#ff0000',
            strokeOpacity: 0.7,
            strokeWeight: 1,
            fillColor: '#ffcccc',
            fillOpacity: 0.5
          });
          mapPolygon.setMap(_map);

          gmaps.event.addListener(mapPolygon, 'click', function() {
            selectPolygonZone(polygonInfo.polygon);
          });

          gmaps.event.addListener(mapPolygon, 'mousemove', clearHover);

          _mapZones[name].push(mapPolygon);
        });

        selectPolygonZone(result.selectedPolygon);
      }
    }).error(function() {
      console.warn(arguments);
    });
  };

  var getCurrentTransition = function(transitions) {
    if (transitions.length === 1) {
      return transitions[0];
    }

    var now = _options.date.getTime() / 1000;
    var selected = null;
    $.each(transitions, function(i, transition) {
      if (transition[0] < now && transitions[i + 1][0] > now) {
        selected = transition;
      }
    });

    // If we couldn't find a matching transition, just use the first one
    // NOTE: This will sometimes be wrong for events in the past
    if (!selected) {
      selected = transitions[0];
    }

    return selected;
  };

  var hideInfoWindow = function() {
    if (_map.lastInfoWindow) {
      _map.lastInfoWindow.close();
    }
  };

  hideLoader = function() {
    _loader.remove();
    _loader = null;
  };

  hitTestAndConvert = function(polygons, lat, lng) {
    var allPolygons = [];
    var inZone = false;
    var selectedPolygon;
    $.each(polygons, function(i, polygon) {
      // Ray casting counter for hit testing.
      var rayTest = 0;
      var lastPoint = polygon.points.slice(-2);

      var coords = [];
      var j = 0;
      for (j = 0; j < polygon.points.length; j += 2) {
        var point = polygon.points.slice(j, j + 2);

        coords.push(new gmaps.LatLng(point[0], point[1]));

        // Ray casting test
        if ((lastPoint[0] <= lat && point[0] >= lat) ||
          (lastPoint[0] > lat && point[0] < lat)) {
          var slope = (point[1] - lastPoint[1]) / (point[0] - lastPoint[0]);
          var testPoint = slope * (lat - lastPoint[0]) + lastPoint[1];
          if (testPoint < lng) {
            rayTest++;
          }
        }

        lastPoint = point;
      }

      allPolygons.push({
        polygon: polygon,
        coords: coords
      });

      // If the count is odd, we are in the polygon
      var odd = (rayTest % 2 === 1);
      inZone |= odd;
      if (odd) {
        selectedPolygon = polygon;
      }
    });

    return {
      allPolygons: allPolygons,
      inZone: inZone,
      selectedPolygon: selectedPolygon
    };
  };

  var mapClickHandler = function(e) {
    if (_needsLoader > 0) {
      return;
    }

    hideInfoWindow();

    var lat = e.latLng.lat();
    var lng = e.latLng.lng();

    var candidates = [];
    $.each(_boundingBoxes, function(i, v) {
      var bb = v.boundingBox;
      if (lat > bb.ymin && lat < bb.ymax &&
      lng > bb.xmin &&
      lng < bb.xmax) {
        candidates.push(slugifyName(v.name));
      }
    });

    _needsLoader = candidates.length;
    setTimeout(function() {
      if (_needsLoader > 0) {
        showLoader();
      }
    }, 500);

    clearZones();
    $.each(candidates, function(i, v) {
      drawZone(v, lat, lng, function() {
        $.each(_hoverPolygons, function(i, p) {
          p.setMap(null);
        });
        _hoverPolygons = [];
        _currentHoverRegion = null;
      });
    });
  };

  selectPolygonZone = function(polygon) {
    _selectedPolygon = polygon;

    var transition = getCurrentTransition(
      _transitions[polygon.name]);

    var olsonName = polygon.name;
    var utcOffset = transition[1];
    var tzName = transition[2];

    if (_options.onSelected) {
      _options.onSelected(olsonName, utcOffset, tzName);
    }
    else {
      var pad = function(d) {
        if (d < 10) {
          return '0' + d;
        }
        return d.toString();
      };

      var now = new Date();
      var adjusted = new Date();
      adjusted.setTime(adjusted.getTime() +
        (adjusted.getTimezoneOffset() + utcOffset) * 60 * 1000);

      showInfoWindow('<h2>' +
        olsonName.split('/').slice(-1)[0].replace('_', ' ') + ' ' +
        '(' + tzName + ')</h2>' +
        '<div class="metadata">' +
        '<div>Current Time: ' +
        pad(adjusted.getHours()) + ':' +
        pad(adjusted.getMinutes()) + ':' +
        pad(adjusted.getSeconds()) + '</div>' +
        '<div>Your Time: ' +
        pad(now.getHours()) + ':' +
        pad(now.getMinutes()) + ':' +
        pad(now.getSeconds()) + '</div>' +
        '<div>UTC Offset (in hours): ' +
        (utcOffset / 60) + '</div>' +
        '</div>');
    }
  };

  showInfoWindow = function(content, callback) {
    // Hack to get the centroid of the largest polygon - we just check
    // which has the most edges
    var centroid;
    var maxPoints = 0;
    if (_selectedPolygon.points.length > maxPoints) {
      centroid = _selectedPolygon.centroid;
      maxPoints = _selectedPolygon.points.length;
    }

    hideInfoWindow();

    var infowindow = new gmaps.InfoWindow({
      content: '<div id="timezone_picker_infowindow" class="timezone-picker-infowindow">' +
      content +
      '</div>'
    });

    gmaps.event.addListener(infowindow, 'domready', function() {
      // HACK: Put rounded corners on the infowindow
      $('#timezone_picker_infowindow').parent().parent().parent().prev().css('border-radius', '5px');

      if (callback) {
        callback.apply($('#timezone_picker_infowindow'));
      }
    });
    infowindow.setPosition(new gmaps.LatLng(centroid[1], centroid[0]));
    infowindow.open(_map);

    _map.lastInfoWindow = infowindow;
  };

  var showLoader = function() {
    _loader = $('<div style="background: url(' + _maskPng +
    ');z-index:10000;position: absolute;top:0;left:0;">' +
    '<img style="position:absolute;' +
    'top:50%; left:50%;margin-top:-8px;margin-left:-8px" ' +
    'src="' +
    _loaderGif +
    '" /></div>');
    _loader.height(_self.height()).width(_self.width());
    _self.append(_loader);
  };

  slugifyName = function(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  };

  var methods = {
    init: function(options) {
      _self = this;

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
      _options.jsonRootUrl = _options.jsonRootUrl || 'tz_json/';
      _options.date = _options.date || new Date();

      _options.mapOptions = $.extend({
        zoom: _options.initialZoom,
        mapTypeId: gmaps.MapTypeId.ROADMAP,
        center: new gmaps.LatLng(_options.initialLat, _options.initialLng)
      }, _options.mapOptions);

      if (typeof _options.hoverRegions === 'undefined') {
        _options.hoverRegions = true;
      }

      // Create the maps instance
      _map = new gmaps.Map(_self.get(0), _options.mapOptions);

      // Load the necessary data files
      var loadCount = _options.hoverRegions ? 2 : 1;
      var checkLoading = function() {
        loadCount--;
        if (loadCount === 0) {
          hideLoader();

          if (_options.onReady) {
            _options.onReady();
          }
        }
      };

      showLoader();
      $.get(_options.jsonRootUrl + 'bounding_boxes.json', function(data) {
        _boundingBoxes = typeof data === 'string' ? JSON.parse(data) : data;
        $.each(_boundingBoxes, function(i, bb) {
          $.extend(_zoneCentroids, bb.zoneCentroids);
        });
        checkLoading();
      });

      if (_options.hoverRegions) {
        $.get(_options.jsonRootUrl + 'hover_regions.json', function(data) {
          var hoverData = typeof data === 'string' ? JSON.parse(data) : data;
          $.each(hoverData, function(i, v) {
            _hoverRegions[v.name] = v;
          });
          checkLoading();
        });
      }

      if (_options.hoverRegions) {
        gmaps.event.addListener(_map, 'mousemove', function(e) {
          var lat = e.latLng.lat();
          var lng = e.latLng.lng();

          $.each(_boundingBoxes, function(i, v) {
            var bb = v.boundingBox;
            if (lat > bb.ymin && lat < bb.ymax &&
            lng > bb.xmin &&
            lng < bb.xmax) {
              var hoverRegion = _hoverRegions[v.name];
              if (!hoverRegion) {
                return;
              }

              var result = hitTestAndConvert(hoverRegion.hoverRegion, lat, lng);
              var slugName = slugifyName(v.name);
              if (result.inZone && slugName !== _currentHoverRegion &&
                slugName !== _selectedRegionKey) {
                clearHover();
                _currentHoverRegion = slugName;

                $.each(result.allPolygons, function(i, polygonInfo) {
                  var mapPolygon = new gmaps.Polygon({
                    paths: polygonInfo.coords,
                    strokeColor: '#444444',
                    strokeOpacity: 0.7,
                    strokeWeight: 1,
                    fillColor: '#888888',
                    fillOpacity: 0.5
                  });
                  mapPolygon.setMap(_map);

                  gmaps.event.addListener(mapPolygon, 'click', mapClickHandler);

                  _hoverPolygons.push(mapPolygon);
                });

                if (_options.onHover) {
                  var transition = getCurrentTransition(hoverRegion.transitions);
                  _options.onHover(transition[1], transition[2]);
                }
              }
            }
          });
        });
      }

      gmaps.event.addListener(_map, 'click', mapClickHandler);
    },
    setDate: function(date) {
      hideInfoWindow();
      _options.date = date;
    },
    hideInfoWindow: hideInfoWindow,
    showInfoWindow: function(content, callback) {
      showInfoWindow(content, callback);
    },
    selectZone: function(olsonName) {
      var centroid = _zoneCentroids[olsonName];
      if (centroid) {
        mapClickHandler({
          latLng: {
            lat: function() {
              return centroid[1];
            },
            lng: function() {
              return centroid[0];
            }
          }
        });
      }
    }
  };

  $.fn.timezonePicker = function(method) {
    gmaps = google.maps;
    if (methods[method]) {
      return methods[method].apply(this, Array.prototype.slice.call(arguments, 1));
    }
    else if (typeof method === 'object' || !method) {
      return methods.init.apply(this, arguments);
    }
    else {
      $.error('Method ' + method + ' does not exist on jQuery.timezonePicker.');
    }
  };

  _loaderGif = "data:image/gif;base64,R0lGODlhEAAQAPIAAKqqqv///729vejo6P///93d3dPT083NzSH/C05FVFNDQVBFMi4wAwEAAAAh/hpDcmVhdGVkIHdpdGggYWpheGxvYWQuaW5mbwAh+QQJCgAAACwAAAAAEAAQAAADMwi63P4wyklrE2MIOggZnAdOmGYJRbExwroUmcG2LmDEwnHQLVsYOd2mBzkYDAdKa+dIAAAh+QQJCgAAACwAAAAAEAAQAAADNAi63P5OjCEgG4QMu7DmikRxQlFUYDEZIGBMRVsaqHwctXXf7WEYB4Ag1xjihkMZsiUkKhIAIfkECQoAAAAsAAAAABAAEAAAAzYIujIjK8pByJDMlFYvBoVjHA70GU7xSUJhmKtwHPAKzLO9HMaoKwJZ7Rf8AYPDDzKpZBqfvwQAIfkECQoAAAAsAAAAABAAEAAAAzMIumIlK8oyhpHsnFZfhYumCYUhDAQxRIdhHBGqRoKw0R8DYlJd8z0fMDgsGo/IpHI5TAAAIfkECQoAAAAsAAAAABAAEAAAAzIIunInK0rnZBTwGPNMgQwmdsNgXGJUlIWEuR5oWUIpz8pAEAMe6TwfwyYsGo/IpFKSAAAh+QQJCgAAACwAAAAAEAAQAAADMwi6IMKQORfjdOe82p4wGccc4CEuQradylesojEMBgsUc2G7sDX3lQGBMLAJibufbSlKAAAh+QQJCgAAACwAAAAAEAAQAAADMgi63P7wCRHZnFVdmgHu2nFwlWCI3WGc3TSWhUFGxTAUkGCbtgENBMJAEJsxgMLWzpEAACH5BAkKAAAALAAAAAAQABAAAAMyCLrc/jDKSatlQtScKdceCAjDII7HcQ4EMTCpyrCuUBjCYRgHVtqlAiB1YhiCnlsRkAAAOwAAAAAAAAAAAA==";
  _maskPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAAZiS0dEAP8A/wD/oL2nkwAAAAlwSFlzAAALEwAACxMBAJqcGAAAAAd0SU1FB9sJDgA6CHKQBUUAAAAZdEVYdENvbW1lbnQAQ3JlYXRlZCB3aXRoIEdJTVBXgQ4XAAAADUlEQVQI12NgYGDwAQAAUQBNbrgEdAAAAABJRU5ErkJggg==";
})(jQuery);
