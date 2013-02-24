#!/bin/bash
mkdir -p example_site
cd openlayers/build
./build.py light.cfg
cd ../..
cp gmaps_example.html example_site
cp openlayers_example.html example_site
cp jquery.timezone-picker.js example_site
cp -R openlayers/build/OpenLayers.js example_site
cp -R openlayers/img example_site
cp -R openlayers/theme example_site
cp tz_json.tgz example_site
cd example_site
tar xvf tz_json.tgz
cd ..
