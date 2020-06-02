// https://epsg.io/31258
// https://spatialreference.org/ref/epsg/mgi-austria-gk-m31/
const fromProjection = "+proj=tmerc +lat_0=0 +lon_0=13.33333333333333 +k=1 +x_0=450000 +y_0=-5000000 +ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs";

//https://overpass-turbo.eu/s/Tpm

// https://github.com/ginseng666/GeoJSON-TopoJSON-Austria/blob/master/2017/simplified-99.9/laender_999_geo.json

var app = new Vue({

    el: '#app',
    data: {
        data: null,
        overpassData: null,
        leaflet: {
            tileLayers: {
                satellite: null,
                map: null
            },
            selectedTileLayer: null,
            map: null,
            zoom: 12,
            boundingBox: null,
            geohashLayer: null
        },
        geohashLevel: 7,
        processed: {
            osmKnown: {}, // geohash->point
            salzburg: [],
        }
    },
    computed: {
        loading: function () {
            return !(this.overpassData !== null && this.data !== null);
        }
    },
    methods: {
        renderGeohashes: function(lat, lon) {

            if(this.leaflet.geohashLayer != null) {
                this.leaflet.geohashLayer.remove(this.leaflet.map);
            }

            const geohash = Geohash.encode(lat, lon, this.geohashLevel);
            const neighbours = Geohash.neighbours(geohash);
            const neighboursArr = Object.keys(neighbours).map(n => neighbours[n]);
            neighboursArr.push(geohash);

            const rectangles = neighboursArr.map(gh => Geohash.bounds(gh)).map(bounds => L.rectangle([[bounds.sw.lat, bounds.sw.lon], [bounds.ne.lat, bounds.ne.lon]], {color: "rgba(255,120,0,0.5)", weight: 1, interactive:false}));
            this.leaflet.geohashLayer = L.featureGroup(rectangles);
            this.leaflet.geohashLayer.addTo(this.leaflet.map);

        },
        selectTileLayer: function(layerName) {
          this.leaflet.selectedTileLayer = layerName;
        },
        convert: function(geometry) {
            const projection = proj4(fromProjection,"WGS84",[geometry.x,geometry.y]);
            return L.latLng(projection[1], projection[0]);
        },
        initializeLeaflet: function () {
            this.leaflet.map = L.map('mapid', {preferCanvas: true}).setView([47.8095, 13.0550], this.leaflet.zoom);
            this.leaflet.map.on("zoomend", (e) => {
                this.leaflet.zoom = this.leaflet.map.getZoom();
            });

            const mapLink = '<a href="http://www.esri.com/">Esri</a>';
            const wholink = 'i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';

            this.leaflet.tileLayers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: '&copy; '+mapLink+', '+wholink,
            });

            this.leaflet.tileLayers.map = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                maxNativeZoom: 19,
                maxZoom: 25
            });

            this.leaflet.selectedTileLayer = 'map';

            L.control.scale().addTo(this.leaflet.map);

        },
        loadData: function () {
            return fetch('gipfel.json')
                .then(response => response.json())
                .then(result => {
                    this.data = result;
                })
        },
        loadOverpassData: function () {
            //const bb = this.leaflet.boundingBox;
            //const overpassBB = [bb.getSouth(), bb.getWest(), bb.getNorth(), bb.getEast()].join(',');
            const overpassBB = '46.94385138036932,12.07691233489001,48.02631643546017,13.994046551932867';
            const query = `
            [out:json][timeout:25];
            (
            node ["natural"="peak"](${overpassBB});
            node ["natural"="saddle"](${overpassBB});
            );
            (._;>;);
            out;
            `;
            const data = new URLSearchParams();
            data.append('data', query);
            return fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                body: data
            })
                .then(response => response.json())
                .then(result => {
                    this.overpassData = result;
                })
        }
    },
    watch: {
        'data': function () {
            // https://desktop.arcgis.com/en/arcmap/10.5/map/projections/pdf/projected_coordinate_systems.pdf
            // https://service.salzburg.gv.at/ogd/client/showDetail/359c515c-4320-42ef-b4e5-88ba1bb03c2e
            const markers = this.data.features
                .filter(feature => feature.attributes.HOEHE > 0)
                .map(feature => {
                    const elevation = feature.attributes.HOEHE;
                    const coordinates = this.convert(feature.geometry);

                    const geohash = Geohash.encode(coordinates.lat, coordinates.lng, this.geohashLevel);
                    const known = this.processed.osmKnown[geohash];

                    const marker = L.circleMarker(coordinates, {
                        radius:4,
                        color: known ? 'rgba(78,255,118,0.5)' : 'rgba(255,0,0,1)'
                    });

                    marker.on('mouseover', (ev) => {
                        this.renderGeohashes(coordinates.lat, coordinates.lng);
                    });

                    marker.bindPopup(`${feature.attributes.FEAT_NAME}, ${elevation}m, OGD Salzburg #${feature.attributes.OBJECTID}`);
                    return marker;
                });

            const layer = L.featureGroup(markers);
            layer.addTo(this.leaflet.map);
            this.leaflet.boundingBox = layer.getBounds();

        },
        'leaflet.boundingBox': function () {
            this.leaflet.map.fitBounds(this.leaflet.boundingBox);
        },
        'overpassData': function () {
            this.overpassData.elements.forEach(element => {
                const geohash = Geohash.encode(element.lat, element.lon, this.geohashLevel);
                const neighbours = Geohash.neighbours(geohash);
                const neighboursArr = Object.keys(neighbours).map(n => neighbours[n]);
                neighboursArr.push(geohash);
                neighboursArr.forEach(gh => {
                    this.processed.osmKnown[gh] = true;
                })
            });
            const markers = this.overpassData.elements.map(element => {
                const marker = L.circleMarker([element.lat, element.lon], {
                    radius:4,
                    color:'rgba(40,167,255,0.5)'
                });
                marker.bindPopup(`${element.tags.name}, ${element.tags.ele}m; OSM #<a href="https://www.openstreetmap.org/node/${element.id}">${element.id}</a>`);
                return marker;
            });
            const layer = L.featureGroup(markers);
            layer.addTo(this.leaflet.map);
        },
        'leaflet.selectedTileLayer': function () {
            Object.keys(this.leaflet.tileLayers)
                .filter(key => key !== this.leaflet.selectedTileLayer)
                .forEach(key => {
                    this.leaflet.tileLayers[key].remove(this.leaflet.map);
                });
            this.leaflet.tileLayers[this.leaflet.selectedTileLayer].addTo(this.leaflet.map);
        }
    },
    mounted: function () {
        this.initializeLeaflet();
        this.loadOverpassData()
            .then(() => this.loadData());
    }
});

