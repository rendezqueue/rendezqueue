#!/bin/sh

set -e

n=$1
test -n "$n"
n=$(($n / 3))

parallelism=10
count_per_process=$((($n + $parallelism - 1) / $parallelism))
n=$(($count_per_process * $parallelism))

printf 'Sending %u * %u processes * 3 phases == %u requests\n' \
  ${count_per_process} ${parallelism} $((3 * $n))

xargs_cmd="xargs -n 1 -P ${parallelism} ./bazel-bin/src/ccgrpc/syncclient --count ${count_per_process}"

seq 1 "$parallelism" |
${xargs_cmd} --id Alice --key >/dev/null 2>&1

seq 1 "$parallelism" |
${xargs_cmd} --id Bob --key >/dev/null 2>&1

seq 1 "$parallelism" |
${xargs_cmd} --id Alice --key >/dev/null 2>&1

