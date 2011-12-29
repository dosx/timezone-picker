import datetime
import os
import re
import pytz
import shpUtils
import simplejson
from shapely.geometry import Polygon
from shapely.ops import cascaded_union
import time
import sys

def collate_zones(shape_file):
    # First collate the polygons by zone name
    print "Loading SHP file..."
    rows = shpUtils.loadShapefile(shape_file)
    collated = {}
    for row in rows:
        name = row["dbf_data"]["TZID"].strip()
        if name == "uninhabited":
            continue

        sys.stderr.write("Processing row for '%s'\n" % name)
        collated[name] = collated.get(name, [])
        for p in row["shp_data"]["parts"]:
            collated[name].append({
                "points": p["points"],
            })

    # Then add some information and try to simplify/reduce the polygons
    zones = {}
    collation_now = time.time()
    for name, shp_data in collated.iteritems():
        sys.stderr.write("Simpifying %s\n" % name)
        transition_info = []
        tz = pytz.timezone(name)
        if "_utc_transition_times" in dir(tz):
            last_info = [sys.maxint, 0, '']
            for i, transition_time in enumerate(tz._utc_transition_times):
                transition_time = int(time.mktime(transition_time.timetuple()))
                td = tz._transition_info[i][0]
                info = [
                    transition_time,
                    timedelta_to_minutes(td),
                    tz._transition_info[i][2]
                ]

                if transition_time < collation_now:
                    last_info = info
                    continue

                # Include the last timezone prior to now
                if last_info[0] < collation_now:
                    transition_info.append(last_info)

                transition_info.append(info)
                last_info = info

        if len(transition_info) == 0:
            # Assume no daylight savings
            now = datetime.datetime.now()
            td = tz.utcoffset(now)
            transition_info.append([0, timedelta_to_minutes(td),
                                     tz.tzname(now)])


        # calculate a collation key based on future timezone transitions
        collation_key = ''
        for t in transition_info:
            if t[0] >= collation_now:
                collation_key += "%d>%d," % (t[0], t[1])

        # for non-daylight savings regions, just use the utc_offset
        if len(collation_key) == 0:
            collation_key = "0>%d" % transition_info[-1][1]

        zones[collation_key] = zones.get(collation_key, {
            "bounding_box": {
                "xmin": sys.maxint,
                "ymin": sys.maxint,
                "xmax":-sys.maxint - 1,
                "ymax":-sys.maxint - 1
            },
            "polygons": [],
            "transitions": {},
            "name": name
        })

        zones[collation_key]["transitions"][name] = transition_info

        polygons = reduce_polygons(shp_data, 0.1, 0.01, 4, 5000, 0, 0.05)

        for part in polygons:
            polygonInfo = simplify(part["points"])
            polygonInfo["name"] = name
            zones[collation_key]["polygons"].append(polygonInfo)

            b = zones[collation_key]["bounding_box"]
            b["xmin"] = min(b["xmin"], polygonInfo["bounds"][0])
            b["ymin"] = min(b["ymin"], polygonInfo["bounds"][1])
            b["xmax"] = max(b["xmax"], polygonInfo["bounds"][2])
            b["ymax"] = max(b["ymax"], polygonInfo["bounds"][3])
            del polygonInfo["bounds"]

    return zones

def convert_points(polygons):
    # Convert {x,y} to [lat,lng], for more compact JSON
    for polygon in polygons:
        polygon["points"] = reduce(lambda x, y: x + [y["y"], y["x"]],
                                   polygon["points"], [])
    return polygons

def reduce_json(jsonString, maxPrecision=6):
    reduced_precision = re.sub(
        r'(\d)\.(\d{' + str(maxPrecision) + r'})(\d+)', r'\1.\2',
        jsonString
    )

    return re.sub(r'\s', '', reduced_precision)

def reduce_polygons(polygonData, hullAreaThreshold, bufferDistance,
                   bufferResolution, numThreshold, areaThreshold,
                   simplifyThreshold):
    polygons = []
    for p in polygonData:
        polygon = Polygon(map(lambda x: (x["x"], x["y"]),
                              p["points"]))

        # For very small regions, use a convex hull
        if polygon.area < hullAreaThreshold:
            polygon = polygon.convex_hull
        # Also buffer by a small distance to aid the cascaded union
        polygon = polygon.buffer(bufferDistance, bufferResolution)

        polygons.append(polygon)

    # Try to merge some polygons
    polygons = cascaded_union(polygons)

    # Normalize the Polygon or MultiPolygon into an array
    if "exterior" in dir(polygons):
        polygons = [polygons]
    else:
        polygons = [p for p in polygons]

    region = []
    # Sort from largest to smallest to faciliate dropping of small regions
    polygons.sort(key=lambda x:-x.area)
    for p in polygons:
        # Try to include regions that are big enough, once we have a
        # few representative regions
        if len(region) > numThreshold and p.area < areaThreshold:
            break

        p = p.simplify(simplifyThreshold)
        region.append({
            "points": map(lambda x: {"x": x[0], "y": x[1]},
                          p.exterior.coords)
        })

    return region

def simplify(points):
    polygon = Polygon(map(lambda x: (x["x"], x["y"]), points))
    polygon = polygon.simplify(0.05)

    return {
        "points": map(lambda x: {"x": x[0], "y": x[1]},
            polygon.exterior.coords),
        "centroid": (polygon.centroid.x, polygon.centroid.y),
        "bounds": polygon.bounds,
        "area": polygon.area
    }

def timedelta_to_minutes(td):
    return td.days * 24 * 60 + td.seconds / 60

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print 'Usage: python gen_json.py <shape_file> <output_dir>'
        sys.exit(1)

    zones = collate_zones(sys.argv[1])
    boxes = []
    hovers = []

    output_dir = sys.argv[2]
    os.mkdir(os.path.join(output_dir, "polygons"))
    for key, zone in zones.iteritems():
        # calculate a hover region
        sys.stderr.write('Calculating hover region for %s\n' % zone["name"])
        hover_region = reduce_polygons(zone["polygons"], 1, 0.1, 4, 3, 0.5,
                                       0.05)

        # Merge transitions information for all contained timezones
        hoverTransitions = []
        zone_transitions = zone["transitions"].values()
        for i, transition in enumerate(zone_transitions[0]):
            tzNames = {}
            for zone_transition in zone_transitions:
                tzNames[zone_transition[i][2]] = tzNames.get(
                    zone_transition[i][2], 0) + 1

            hoverTransitions.append([
                transition[0],
                transition[1],
                map(lambda x: x[0],
                    sorted(tzNames.iteritems(), key=lambda x:-x[1]))
            ])

        hovers.append({
            "name": zone["name"],
            "hoverRegion": convert_points(hover_region),
            "transitions": hoverTransitions
        })

        # Get a centroid for the largest polygon in each zone
        zone_centroids = {}
        for polygon in zone["polygons"]:
            zone_centroid = zone_centroids.get(polygon["name"], {
                "centroid": (0, 0),
                "area": 0
            })

            if polygon["area"] > zone_centroid["area"]:
                zone_centroids[polygon["name"]] = {
                    "centroid": polygon["centroid"],
                    "area": polygon["area"]
                }

        boxes.append({
            "name": zone["name"],
            "boundingBox": zone["bounding_box"],
            "zoneCentroids": dict(map(
                lambda x: (x[0], x[1]["centroid"]), zone_centroids.iteritems()
            ))
        })

        filename = re.sub(r'[^a-z0-9]+', '-', zone["name"].lower())
        out_file = os.path.join(output_dir, "polygons", "%s.json" % filename)
        open(out_file, "w").write(
            reduce_json(simplejson.dumps({
                "name": zone["name"],
                "polygons": convert_points(zone["polygons"]),
                "transitions": zone["transitions"]
            }), 5))

    open(os.path.join(output_dir, "bounding_boxes.json"), "w").write(
        reduce_json(simplejson.dumps(boxes), 2)
    )
    open(os.path.join(output_dir, "hover_regions.json"), "w").write(
        reduce_json(simplejson.dumps(hovers), 2)
    )
