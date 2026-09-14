"""RLE 压缩，与固件端解码逻辑一致（移植自上位机 js/rle.js）。"""

from typing import List


def rle_compress(data: bytes, max_literal_size: int = 128) -> bytearray:
    out = bytearray()
    i = 0
    n = len(data)

    while i < n:
        run_len = 1
        # 统计重复字节（最多 130）
        while i + run_len < n and run_len < 130 and data[i + run_len] == data[i]:
            run_len += 1

        if run_len >= 3:
            # 重复段: control = 0x80 | (run_len - 3)
            out.append(0x80 | (run_len - 3))
            out.append(data[i])
            i += run_len
        else:
            # 字面段: 最多收集 max_literal_size 字节
            literal_start = i
            literal_len = 0
            while i < n and literal_len < max_literal_size:
                # 后面出现 >=3 的重复段时截断
                if i + 2 < n and data[i] == data[i + 1] and data[i] == data[i + 2]:
                    break
                literal_len += 1
                i += 1
            if literal_len == 0:
                out.append(0x00)
                out.append(data[i])
                i += 1
            else:
                out.append(literal_len - 1)
                out.extend(data[literal_start:literal_start + literal_len])

    return out


def rle_compress_mtu(data: bytes, max_chunk_size: int) -> List[bytes]:
    """整体压缩后按 RLE 码边界切分，保证每个分片都是完整可解码的 RLE 流。"""
    max_lit = min(max_chunk_size - 1, 128)
    if max_lit < 1:
        raise ValueError("max_chunk_size 太小")

    buf = bytes(rle_compress(data, max_lit))
    chunks: List[bytes] = []
    i = 0
    start = 0
    n = len(buf)

    while i < n:
        control = buf[i]
        # 重复码 2 字节；字面码 1 + (control + 1) 字节
        code_len = 2 if (control & 0x80) else (control + 2)
        if i - start + code_len > max_chunk_size and i > start:
            chunks.append(buf[start:i])
            start = i
        i += code_len

    if i > start:
        chunks.append(buf[start:i])
    return chunks
