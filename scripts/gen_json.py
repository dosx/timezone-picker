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

def simplify(points):
    polygon = Polygon(map(lambda x: (x["x"], x["y"]), points))
    polygon = polygon.simplify(0.05)
    return {
        "points": map(lambda x: {"x": x[0], "y": x[1]},
            polygon.exterior.coords),
        "centroid": (polygon.centroid.x, polygon.centroid.y)
    }

def timedelta_to_seconds(td):
    return td.days * 24 * 60 * 60 + td.seconds

def collate_zones(shape_file):
    zones = {}
    print "Loading SHP file..."
    rows = shpUtils.loadShapefile(shape_file)
    collation_now = time.time()
    for row in rows:
        name = row["dbf_data"]["TZID"].strip()
        if name == "uninhabited":
            continue

        sys.stderr.write("Processing row for '%s'\n" % name)

        transition_info = []
        tz = pytz.timezone(name)
        if "_utc_transition_times" not in dir(tz):
            # Assume no daylight savings
            td = tz.utcoffset(datetime.datetime(2000, 1, 1))
            transition_info = [{
                "time": 0,
                "utc_offset": timedelta_to_seconds(td),
                "tzname": tz.tzname(datetime.datetime(2000, 1, 1))
            }]
        else:
            for i, transition_time in enumerate(tz._utc_transition_times):
                td = tz._transition_info[i][0]
                transition_info.append({
                    "time": time.mktime(transition_time.timetuple()),
                    "utc_offset": timedelta_to_seconds(td),
                    "tzname": tz._transition_info[i][2]
                })

        # calculate a collation key based on future timezone transitions
        collation_key = ''
        for t in transition_info:
            if t["time"] >= collation_now:
                collation_key += "%d>%d," % (t["time"], t["utc_offset"])

        # for non-daylight savings regions, just use the utc_offset
        if len(collation_key) == 0:
            collation_key = "0>%d" % transition_info[-1]["utc_offset"]


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

        zones[collation_key] = zones.get(collation_key, {
            "bounding_box": {
                "xmin": sys.maxint,
                "ymin": sys.maxint,
                "xmax":-sys.maxint - 1,
                "ymax":-sys.maxint - 1
            },
            "polygons": []
        })

        shp_data = row["shp_data"]
        for part in shp_data["parts"]:
            polygonInfo = simplify(part["points"])
            if polygonInfo is None:
                continue

            polygonInfo["name"] = name
            zones[collation_key]["polygons"].append(polygonInfo)

        b = zones[collation_key]["bounding_box"]
        b["xmin"] = min(b["xmin"], shp_data["xmin"])
        b["ymin"] = min(b["ymin"], shp_data["ymin"])
        b["xmax"] = max(b["xmax"], shp_data["xmax"])
        b["ymax"] = max(b["ymax"], shp_data["ymax"])

    return zones

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print 'Usage: python gen_json.py <shape_file> <output_dir>'
        sys.exit(1)

    zones = collate_zones(sys.argv[1])
    boxes = []

    output_dir = sys.argv[2]
    os.mkdir(os.path.join(output_dir, "polygons"))
    for key, zone in zones.iteritems():
        # calculate a hover region
        polygons = []
        for p in zone["polygons"]:
            polygons.append(Polygon(map(lambda x: (x["x"], x["y"]),
                                        p["points"])))
        polygons = cascaded_union(polygons)
        if "exterior" in dir(polygons):
            polygons = [polygons]
        hover_region = []
        for p in polygons:
            p = p.simplify(0.2)
            hover_region.append({
                "points": map(lambda x: {"x": x[0], "y": x[1]},
                p.exterior.coords)
            })

        boxes.append({
            "name": zone["name"],
            "boundingBox": zone["bounding_box"],
            "hoverRegion": hover_region
        })

        filename = re.sub(r'[^a-z0-9]+', '-', zone["name"].lower())
        out_file = os.path.join(output_dir, "polygons", "%s.json" % filename)
        open(out_file, "w").write(
            simplejson.dumps({
                "name": zone["name"],
                "polygons": zone["polygons"],
                "transitions": zone["transitions"]
            }))

    open(os.path.join(output_dir, "bounding_boxes.json"), "w").write(
        simplejson.dumps(boxes)
    )
