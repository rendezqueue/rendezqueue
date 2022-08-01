load("@aspect_rules_js//js:defs.bzl", "js_test")
load("@rules_sxproto//sxproto:defs.bzl", "sxproto_data")

def rendezqueue_scenario_test(name):
  sxproto_data(
      name = name,
      src = name + ".sxproto",
      out_json = name + ".json",
      proto_message = "rendezqueue.TrySwapScenario",
      proto_deps = [":scenario_proto"],
      testonly = 1,
      visibility = ["//test/nodejson:__pkg__"],
  )
  js_test(
      name = name + "_nodejson_expect_test",
      data = [
          "//src/nodejson:rendezqueue_json_impl_js",
          "//src/nodejson:swapstore_js",
          "//test/nodejson:expect_test_js",
          ":" + name + ".json",
      ],
      entry_point = "//test/nodejson:expect_test_js",
      args = ["$(location :" + name + ".json)"],
      size = "small",
  )
