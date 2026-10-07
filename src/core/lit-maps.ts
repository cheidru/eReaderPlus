/**
 * Microsoft LIT tag and attribute tables (binary HTML/OPF token → name).
 * Generated from Calibre src/calibre/ebooks/lit/maps/{html,opf}.py (GPL-3.0, Marshall T. Vandegrift),
 * which were copied from ConvertLIT (Dan A. Jackson, GPL). Do not edit by hand.
 */
export interface LitMap {
  tags: (string | null)[];
  attrs: Record<number, string>;
  tagAttrs: (Record<number, string> | null)[];
}

const ATTRS3: Record<number, string> = { 1: "href", 1004: "target", 1006: "rel", 1007: "rev", 1008: "urn", 1009: "methods", 32769: "name", 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS5: Record<number, string> = { 37785: "clear" };
const ATTRS6: Record<number, string> = { 32769: "name", 32774: "width", 32775: "height", 32842: "align", 35771: "classid", 35772: "data", 35775: "codebase", 35776: "codetype", 35777: "code", 35778: "type", 35781: "vspace", 35782: "hspace", 38798: "onerror" };
const ATTRS7: Record<number, string> = { 1: "href", 1002: "shape", 1003: "coords", 1005: "target", 1006: "alt", 1007: "nohref", 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS8: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS9: Record<number, string> = { 1004: "href", 1005: "target" };
const ATTRS10: Record<number, string> = { 37771: "color", 37787: "face", 37795: "size" };
const ATTRS12: Record<number, string> = { 1002: "src", 1003: "loop", 1004: "volume", 1005: "balance" };
const ATTRS13: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS15: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id", 37785: "clear" };
const ATTRS16: Record<number, string> = { 2011: "link", 2012: "alink", 2013: "vlink", 32838: "title", 32843: "style", 33770: "class", 33771: "id", 37770: "background", 37771: "text", 37774: "nowrap", 37806: "topmargin", 37807: "rightmargin", 37808: "bottommargin", 37809: "leftmargin", 37814: "bgproperties", 37848: "scroll", 38779: "onselect", 38801: "onload", 38802: "onunload", 38808: "onbeforeunload", 38835: "onbeforeprint", 38836: "onafterprint", 65036: "bgcolor" };
const ATTRS17: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id", 37785: "clear" };
const ATTRS18: Record<number, string> = { 2001: "type", 32769: "name" };
const ATTRS19: Record<number, string> = { 32838: "title", 32841: "align", 32843: "style", 33770: "class", 33771: "id", 37800: "valign" };
const ATTRS20: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id", 37785: "clear" };
const ATTRS21: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS22: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS23: Record<number, string> = { 1002: "span", 32774: "width", 32841: "align", 37800: "valign", 65036: "bgcolor" };
const ATTRS24: Record<number, string> = { 1002: "span", 32774: "width", 32841: "align", 37800: "valign", 65036: "bgcolor" };
const ATTRS27: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id", 37774: "nowrap" };
const ATTRS29: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS31: Record<number, string> = { 32838: "title", 32841: "align", 32843: "style", 33770: "class", 33771: "id", 37774: "nowrap" };
const ATTRS32: Record<number, string> = { 1002: "compact", 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS33: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id", 37774: "nowrap" };
const ATTRS34: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS35: Record<number, string> = { 32769: "name", 32774: "width", 32775: "height", 32842: "align", 35773: "palette", 35774: "pluginspage", 35775: "src", 35777: "units", 35778: "type", 35779: "hidden" };
const ATTRS36: Record<number, string> = { 32842: "align" };
const ATTRS37: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id", 37771: "color", 37787: "face", 37788: "size" };
const ATTRS38: Record<number, string> = { 1002: "action", 1004: "enctype", 1005: "method", 1007: "target", 1012: "accept-charset", 32769: "name", 38780: "onsubmit", 38781: "onreset" };
const ATTRS39: Record<number, string> = { 32768: "align", 32769: "name", 35769: "src", 35771: "border", 35772: "frameborder", 35773: "framespacing", 35774: "marginwidth", 35775: "marginheight", 35776: "noresize", 35777: "scrolling", 36770: "bordercolor" };
const ATTRS40: Record<number, string> = { 1001: "rows", 1002: "cols", 1003: "border", 1004: "bordercolor", 1005: "frameborder", 1006: "framespacing", 32769: "name", 38801: "onload", 38802: "onunload", 38808: "onbeforeunload", 38835: "onbeforeprint", 38836: "onafterprint" };
const ATTRS42: Record<number, string> = { 32838: "title", 32841: "align", 32843: "style", 33770: "class", 33771: "id", 37785: "clear" };
const ATTRS43: Record<number, string> = { 32838: "title", 32841: "align", 32843: "style", 33770: "class", 33771: "id", 37785: "clear" };
const ATTRS44: Record<number, string> = { 32838: "title", 32841: "align", 32843: "style", 33770: "class", 33771: "id", 37785: "clear" };
const ATTRS45: Record<number, string> = { 32838: "title", 32841: "align", 32843: "style", 33770: "class", 33771: "id", 37785: "clear" };
const ATTRS46: Record<number, string> = { 32838: "title", 32841: "align", 32843: "style", 33770: "class", 33771: "id", 37785: "clear" };
const ATTRS47: Record<number, string> = { 32838: "title", 32841: "align", 32843: "style", 33770: "class", 33771: "id", 37785: "clear" };
const ATTRS49: Record<number, string> = { 1002: "noshade", 32774: "width", 32775: "size", 32838: "title", 32841: "align", 32843: "style", 33770: "class", 33771: "id", 37771: "color" };
const ATTRS51: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS52: Record<number, string> = { 32769: "name", 32774: "width", 32775: "height", 32842: "align", 35769: "src", 35771: "border", 35772: "frameborder", 35773: "framespacing", 35774: "marginwidth", 35775: "marginheight", 35776: "noresize", 35777: "scrolling", 36770: "vspace", 36771: "hspace" };
const ATTRS53: Record<number, string> = { 1003: "alt", 1004: "src", 1005: "border", 1006: "vspace", 1007: "hspace", 1008: "lowsrc", 1009: "vrml", 1010: "dynsrc", 1012: "loop", 1014: "start", 2003: "ismap", 2009: "usemap", 32769: "name", 32774: "width", 32775: "height", 32838: "title", 32842: "align", 32843: "style", 33770: "class", 33771: "id", 38797: "onabort", 38798: "onerror", 38801: "onload" };
const ATTRS54: Record<number, string> = { 2001: "type", 2003: "size", 2004: "maxlength", 2006: "readonly", 2008: "indeterminate", 2010: "checked", 2011: "alt", 2012: "src", 2013: "border", 2014: "vspace", 2015: "hspace", 2016: "lowsrc", 2017: "vrml", 2018: "dynsrc", 2020: "loop", 2021: "start", 32769: "name", 32774: "width", 32775: "height", 32842: "align", 37870: "value", 38779: "onselect", 38797: "onabort", 38798: "onerror", 38799: "onchange", 38801: "onload" };
const ATTRS56: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS57: Record<number, string> = { 1001: "for" };
const ATTRS58: Record<number, string> = { 32842: "align" };
const ATTRS59: Record<number, string> = { 1002: "value", 32838: "title", 32843: "style", 33770: "class", 33771: "id", 37786: "type" };
const ATTRS60: Record<number, string> = { 1006: "href", 1007: "rel", 1008: "rev", 1009: "type", 1017: "media", 1018: "target", 32838: "title", 32843: "style", 33770: "class", 33771: "id", 38798: "onerror", 38801: "onload" };
const ATTRS61: Record<number, string> = { 37785: "clear" };
const ATTRS62: Record<number, string> = { 32769: "name", 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS63: Record<number, string> = { 6001: "scrolldelay", 6002: "direction", 6003: "behavior", 6004: "scrollamount", 6005: "loop", 6006: "vspace", 6007: "hspace", 6008: "truespeed", 32774: "width", 32775: "height", 38789: "onbounce", 38795: "onfinish", 38796: "onstart", 65036: "bgcolor" };
const ATTRS65: Record<number, string> = { 1002: "http-equiv", 1003: "content", 1004: "url", 1014: "charset", 32769: "name" };
const ATTRS66: Record<number, string> = { 1013: "n" };
const ATTRS71: Record<number, string> = { 32768: "usemap", 32769: "name", 32774: "width", 32775: "height", 32838: "title", 32842: "align", 32843: "style", 33770: "class", 33771: "id", 35771: "classid", 35772: "data", 35775: "codebase", 35776: "codetype", 35777: "code", 35778: "type", 35781: "vspace", 35782: "hspace", 38798: "onerror" };
const ATTRS72: Record<number, string> = { 1003: "compact", 1004: "start", 32838: "title", 32843: "style", 33770: "class", 33771: "id", 37786: "type" };
const ATTRS73: Record<number, string> = { 1002: "selected", 1003: "value" };
const ATTRS74: Record<number, string> = { 32838: "title", 32841: "align", 32843: "style", 33770: "class", 33771: "id", 37785: "clear" };
const ATTRS75: Record<number, string> = { 32768: "type" };
const ATTRS76: Record<number, string> = { 37785: "clear" };
const ATTRS77: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id", 37785: "clear" };
const ATTRS78: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS82: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS83: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS84: Record<number, string> = { 1002: "src", 1005: "for", 1006: "event", 1008: "defer", 1010: "type", 38798: "onerror" };
const ATTRS85: Record<number, string> = { 1003: "size", 1004: "multiple", 32768: "align", 32769: "name", 38799: "onchange" };
const ATTRS86: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS87: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS88: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS89: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS90: Record<number, string> = { 1003: "type", 1007: "media", 32838: "title", 38798: "onerror", 38801: "onload" };
const ATTRS91: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS92: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS93: Record<number, string> = { 1002: "cols", 1003: "border", 1004: "rules", 1005: "frame", 1006: "cellspacing", 1007: "cellpadding", 1018: "datapagesize", 32774: "width", 32775: "height", 32838: "title", 32842: "align", 32843: "style", 33770: "class", 33771: "id", 37770: "background", 37797: "bordercolor", 37798: "bordercolorlight", 37799: "bordercolordark", 65036: "bgcolor" };
const ATTRS94: Record<number, string> = { 32841: "align", 37800: "valign", 65036: "bgcolor" };
const ATTRS95: Record<number, string> = { 32841: "align", 37800: "valign" };
const ATTRS96: Record<number, string> = { 2002: "rowspan", 2003: "colspan", 32774: "width", 32775: "height", 32838: "title", 32841: "align", 32843: "style", 33770: "class", 33771: "id", 37770: "background", 37774: "nowrap", 37797: "bordercolor", 37798: "bordercolorlight", 37799: "bordercolordark", 37800: "valign", 65036: "bgcolor" };
const ATTRS97: Record<number, string> = { 7002: "rows", 7003: "cols", 7004: "wrap", 7005: "readonly", 32769: "name", 38779: "onselect", 38799: "onchange" };
const ATTRS98: Record<number, string> = { 32841: "align", 37800: "valign", 65036: "bgcolor" };
const ATTRS99: Record<number, string> = { 2002: "rowspan", 2003: "colspan", 32774: "width", 32775: "height", 32838: "title", 32841: "align", 32843: "style", 33770: "class", 33771: "id", 37770: "background", 37774: "nowrap", 37797: "bordercolor", 37798: "bordercolorlight", 37799: "bordercolordark", 37800: "valign", 65036: "bgcolor" };
const ATTRS100: Record<number, string> = { 32841: "align", 37800: "valign", 65036: "bgcolor" };
const ATTRS102: Record<number, string> = { 32775: "height", 32838: "title", 32841: "align", 32843: "style", 33770: "class", 33771: "id", 37797: "bordercolor", 37798: "bordercolorlight", 37799: "bordercolordark", 37800: "valign", 65036: "bgcolor" };
const ATTRS103: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS104: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };
const ATTRS105: Record<number, string> = { 1003: "compact", 32838: "title", 32843: "style", 33770: "class", 33771: "id", 37786: "type" };
const ATTRS106: Record<number, string> = { 32838: "title", 32843: "style", 33770: "class", 33771: "id" };

export const HTML_MAP: LitMap = {
  tags: [null, null, null, "a", "acronym", "address", "applet", "area", "b", "base", "basefont", "bdo", "bgsound", "big", "blink", "blockquote", "body", "br", "button", "caption", "center", "cite", "code", "col", "colgroup", null, null, "dd", "del", "dfn", "dir", "div", "dl", "dt", "em", "embed", "fieldset", "font", "form", "frame", "frameset", null, "h1", "h2", "h3", "h4", "h5", "h6", "head", "hr", "html", "i", "iframe", "img", "input", "ins", "kbd", "label", "legend", "li", "link", "tag61", "map", "tag63", "tag64", "meta", "nextid", "nobr", "noembed", "noframes", "noscript", "object", "ol", "option", "p", "param", "plaintext", "pre", "q", "rp", "rt", "ruby", "s", "samp", "script", "select", "small", "span", "strike", "strong", "style", "sub", "sup", "table", "tbody", "tc", "td", "textarea", "tfoot", "th", "thead", "title", "tr", "tt", "u", "ul", "var", "wbr", null],
  attrs: { 32784: "tabindex", 32838: "title", 32843: "style", 32845: "disabled", 33770: "class", 33771: "id", 33790: "datafld", 33791: "datasrc", 33792: "dataformatas", 34774: "accesskey", 37778: "lang", 37869: "language", 37886: "dir", 38769: "onmouseover", 38770: "onmouseout", 38771: "onmousedown", 38772: "onmouseup", 38773: "onmousemove", 38774: "onkeydown", 38775: "onkeyup", 38776: "onkeypress", 38777: "onclick", 38778: "ondblclick", 38782: "onhelp", 38783: "onfocus", 38784: "onblur", 38787: "onrowexit", 38788: "onrowenter", 38790: "onbeforeupdate", 38791: "onafterupdate", 38794: "onreadystatechange", 38800: "onscroll", 38804: "ondragstart", 38805: "onresize", 38806: "onselectstart", 38807: "onerrorupdate", 38809: "ondatasetchanged", 38810: "ondataavailable", 38811: "ondatasetcomplete", 38812: "onfilterchange", 38815: "onlosecapture", 38816: "onpropertychange", 38818: "ondrag", 38819: "ondragend", 38820: "ondragenter", 38821: "ondragover", 38822: "ondragleave", 38823: "ondrop", 38824: "oncut", 38825: "oncopy", 38826: "onpaste", 38827: "onbeforecut", 38828: "onbeforecopy", 38829: "onbeforepaste", 38831: "onrowsdelete", 38832: "onrowsinserted", 38833: "oncellchange", 38834: "oncontextmenu", 38838: "onbeforeeditfocus" },
  tagAttrs: [null, null, null, ATTRS3, null, ATTRS5, ATTRS6, ATTRS7, ATTRS8, ATTRS9, ATTRS10, null, ATTRS12, ATTRS13, null, ATTRS15, ATTRS16, ATTRS17, ATTRS18, ATTRS19, ATTRS20, ATTRS21, ATTRS22, ATTRS23, ATTRS24, null, null, ATTRS27, null, ATTRS29, null, ATTRS31, ATTRS32, ATTRS33, ATTRS34, ATTRS35, ATTRS36, ATTRS37, ATTRS38, ATTRS39, ATTRS40, null, ATTRS42, ATTRS43, ATTRS44, ATTRS45, ATTRS46, ATTRS47, null, ATTRS49, null, ATTRS51, ATTRS52, ATTRS53, ATTRS54, null, ATTRS56, ATTRS57, ATTRS58, ATTRS59, ATTRS60, ATTRS61, ATTRS62, ATTRS63, null, ATTRS65, ATTRS66, null, null, null, null, ATTRS71, ATTRS72, ATTRS73, ATTRS74, ATTRS75, ATTRS76, ATTRS77, ATTRS78, null, null, null, ATTRS82, ATTRS83, ATTRS84, ATTRS85, ATTRS86, ATTRS87, ATTRS88, ATTRS89, ATTRS90, ATTRS91, ATTRS92, ATTRS93, ATTRS94, ATTRS95, ATTRS96, ATTRS97, ATTRS98, ATTRS99, ATTRS100, null, ATTRS102, ATTRS103, ATTRS104, ATTRS105, ATTRS106, null, null],
};

export const OPF_MAP: LitMap = {
  tags: [null, "package", "dc:Title", "dc:Creator", null, null, null, null, null, null, null, null, null, null, null, null, "manifest", "item", "spine", "itemref", "metadata", "dc-metadata", "dc:Subject", "dc:Description", "dc:Publisher", "dc:Contributor", "dc:Date", "dc:Type", "dc:Format", "dc:Identifier", "dc:Source", "dc:Language", "dc:Relation", "dc:Coverage", "dc:Rights", "x-metadata", "meta", "tours", "tour", "site", "guide", "reference", null],
  attrs: { 1: "href", 2: "%never-used", 3: "%guid", 4: "%minimum_level", 5: "%attr5", 6: "id", 7: "href", 8: "media-type", 9: "fallback", 10: "idref", 11: "xmlns:dc", 12: "xmlns:oebpackage", 13: "role", 14: "file-as", 15: "event", 16: "scheme", 17: "title", 18: "type", 19: "unique-identifier", 20: "name", 21: "content", 22: "xml:lang" },
  tagAttrs: [],
};
