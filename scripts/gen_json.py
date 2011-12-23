import datetime
import os
import re
import pytz
import shpUtils
import simplejson
from shapely.geometry import Polygon
import time
import sys

def simplify(points):
    polygon = Polygon(map(lambda x: (x["x"], x["y"]), points))
    polygon = polygon.simplify(0.025)
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
    for row in rows:
        name = row["dbf_data"]["TZID"].strip()
        if name == "uninhabited":
            continue

        zones[name] = zones.get(name, {
            "bounding_box": {
                "xmin": sys.maxint,
                "ymin": sys.maxint,
                "xmax":-sys.maxint - 1,
                "ymax":-sys.maxint - 1
            },
            "polygons": []
        })

        sys.stderr.write("Processing row for '%s'\n" % name)

        if not "transitions" in zones[name]:
            tz = pytz.timezone(name)
            transition_info = []
            if "_utc_transition_times" not in dir(tz):
                # Assume no daylight savings
                td = tz.utcoffset(datetime.datetime(2000, 1, 1))
                zones[name]["transitions"] = [{
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

            zones[name]["transitions"] = transition_info

        shp_data = row["shp_data"]
        for part in shp_data["parts"]:
            zones[name]["polygons"].append(simplify(part["points"]))

        b = zones[name]["bounding_box"]
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
    os.mkdir(os.path.join(output_dir, "transitions"))
    for name, zone in zones.iteritems():
        boxes.append({
            "name": name,
            "boundingBox": zone["bounding_box"]
        })

        filename = re.sub(r'[^a-z0-9]+', '-', name.lower())
        out_file = os.path.join(output_dir, "polygons", "%s.json" % filename)
        open(out_file, "w").write(
            simplejson.dumps({
                "name": name,
                "polygons": zone["polygons"]
            }))
        out_file = os.path.join(output_dir, "transitions", "%s.json" % filename)
        open(out_file, "w").write(
            simplejson.dumps({
                "name": name,
                "transitions": zone["transitions"]
            }))

    open(os.path.join(output_dir, "bounding_boxes.json"), "w").write(
        simplejson.dumps(boxes)
    )
