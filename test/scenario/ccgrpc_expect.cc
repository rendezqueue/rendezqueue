
#ifdef NDEBUG
#undef NDEBUG
#endif

#include <cassert>
#include <fstream>
#include <iostream>

#include "src/ccgrpc/rendezqueue_protobuf_impl.hh"
#include "test/scenario/scenario.pb.h"

#define assert_true(a) \
  if (!a) { \
    std::cerr << #a << " should be true" << std::endl; \
    return 1; \
  }
#define assert_equal(a, b) \
  if (a != b) { \
    std::cerr << #a << "==" << (a) << " != " << (b) \
      << " as expected at index+1==" << (i+1) << std::endl; \
    return 1; \
  }

int MainScenarioTest(const std::string& filename) {
  rendezqueue::TrySwapScenario scenario;
  {
    std::ifstream scenario_istream(filename, std::ios::in | std::ios::binary);
    bool parsed = scenario.ParseFromIstream(&scenario_istream);
    assert_true(parsed);
  }
  rendezqueue::RendezqueueProtobufImpl rendezqueue_protobuf_impl;
  uint64_t timestamp_ms = 0;

  for (unsigned i = 0; i < (unsigned)scenario.expectations_size(); ++i) {
    const rendezqueue::TrySwapExpectation& e = scenario.expectations(i);
    timestamp_ms += e.delta_ms();
    rendezqueue::TrySwapResponse res;
    unsigned http_status_code = rendezqueue_protobuf_impl.TrySwap(
        &e.req(), timestamp_ms, &res);
    if (e.http_status_code() > 0) {
      assert_equal(http_status_code, e.http_status_code());
    }
    else if (e.has_res()) {
      assert_equal(res.key(), e.res().key());
      assert_equal(res.id(), e.res().id());
      assert_equal(res.ttl(), e.res().ttl());
      assert_equal(res.offset(), e.res().offset());
      assert_equal(res.values_size(), e.res().values_size());
      for (unsigned j = 0; j < (unsigned)e.res().values_size(); ++j) {
        assert_equal(res.values(j), e.res().values(j));
      }
    }
    else {
      if (!e.has().key().empty()) {
        assert_equal(res.key(), e.has().key());
      }
      if (!e.has().id().empty()) {
        assert_equal(res.id(), e.has().id());
      }
      if (e.has().ttl() > 0) {
        assert_equal(res.ttl(), e.has().ttl());
      }
      if (e.has().offset() > 0) {
        assert_equal(res.offset(), e.has().offset());
      }
      if (e.has().values_size() > 0) {
        assert_equal(res.values_size(), e.has().values_size());
        for (unsigned j = 0; j < (unsigned)e.has().values_size(); ++j) {
          assert_equal(res.values(j), e.has().values(j));
        }
      }
    }
  }
  return 0;
}

int main(int argc, char** argv)
{
  int istat = 0;
  if (argc != 2) {
    istat = 65;
  }
  if (istat == 0) {
    istat = MainScenarioTest(argv[1]);
  }
  google::protobuf::ShutdownProtobufLibrary();
  return istat;
}
